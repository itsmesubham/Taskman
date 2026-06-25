from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Any
from ..database import fetch_all, fetch_one, execute, get_conn
from ..security import get_current_user
from ..utils import row_to_json, rows_to_json
from ..services.activity import record_activity
from ..services.agent_workflow import ISSUE_SELECT_COLUMNS, ensure_safe_repo, project_repository_row
from ..services.issue_lookup import fetch_issue_by_id, fetch_issue_by_key
from ..services.workspace_defaults import ensure_workspace_board_defaults, ensure_default_project, ensure_current_monthly_sprint
from ..sse import event_bus

router = APIRouter(prefix="/api/issues", tags=["issues"])

VALID_STATUSES = {"BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "CHANGES_REQUESTED", "DONE", "BLOCKED"}
VALID_TYPES = {"TASK", "BUG", "STORY", "EPIC", "IMPROVEMENT"}
VALID_PRIORITIES = {"LOW", "MEDIUM", "HIGH", "URGENT"}


class IssueCreate(BaseModel):
    project_id: str | None = None
    title: str = Field(min_length=1, max_length=240)
    description: str = ""
    issue_type: str = "TASK"
    status: str = "BACKLOG"
    priority: str = "MEDIUM"
    ai_pickable: bool = False
    repository_id: str | None = None
    github_repo: str | None = None
    github_branch: str | None = None
    sprint_id: str | None = None
    assignee_id: str | None = None
    story_points: int = Field(default=0, ge=0, le=100)
    due_date: str | None = None
    labels: list[str] = Field(default_factory=list)


class IssueUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=240)
    description: str | None = None
    issue_type: str | None = None
    status: str | None = None
    priority: str | None = None
    project_id: str | None = None
    sprint_id: str | None = None
    assignee_id: str | None = None
    ai_pickable: bool | None = None
    repository_id: str | None = None
    github_repo: str | None = None
    github_branch: str | None = None
    github_pr_url: str | None = None
    github_pr_number: int | None = None
    github_pr_status: str | None = None
    agent_summary: str | None = None
    agent_test_notes: str | None = None
    agent_blocker_reason: str | None = None
    story_points: int | None = Field(default=None, ge=0, le=100)
    due_date: str | None = None
    labels: list[str] | None = None
    position: int | None = None


class StatusUpdate(BaseModel):
    status: str
    position: int | None = None


class SprintAssignment(BaseModel):
    sprint_id: str | None = None
    status: str | None = None


class ReorderItem(BaseModel):
    id: str
    status: str | None = None
    position: int
    sprint_id: str | None = None


class ReorderRequest(BaseModel):
    items: list[ReorderItem]


def validate_issue_values(issue_type: str | None = None, status: str | None = None, priority: str | None = None):
    if issue_type and issue_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="Invalid issue_type")
    if status and status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    if priority and priority not in VALID_PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid priority")


def resolve_tenant_id(current_user: dict) -> str:
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Workspace not selected")
    return str(tenant_id)


def ensure_project(project_id: str, tenant_id: str):
    project = fetch_one(
        "SELECT id, tenant_id, name, key, description, visibility, status, issue_counter, created_by, created_at, updated_at FROM projects WHERE id = %s AND tenant_id = %s",
        (project_id, tenant_id),
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def ensure_issue(issue_id: str, tenant_id: str):
    issue = fetch_issue_by_id(issue_id, tenant_id, with_related=False)
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


def ensure_issue_by_key(issue_key: str, tenant_id: str):
    issue = fetch_issue_by_key(issue_key, tenant_id)
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


def ensure_sprint(sprint_id: str | None, tenant_id: str, project_id: str):
    if not sprint_id:
        return None
    sprint = fetch_one(
        "SELECT id, tenant_id, project_id, name, goal, status, start_date, end_date, created_by, issue_count, created_at, updated_at FROM sprints WHERE id = %s AND tenant_id = %s AND project_id = %s",
        (sprint_id, tenant_id, project_id),
    )
    if not sprint:
        raise HTTPException(status_code=404, detail="Sprint not found")
    return sprint


def ensure_project_for_task(tenant_id: str, project_id: str | None):
    if project_id:
        return ensure_project(project_id, tenant_id)
    return ensure_default_project(tenant_id)


def resolve_task_repository(tenant_id: str, project_id: str, *, repository_id: str | None = None, github_repo: str | None = None, ai_pickable: bool = False, issue_repository_id: str | None = None, issue_github_repo: str | None = None):
    repo_id = repository_id or issue_repository_id
    repo_value = ensure_safe_repo(github_repo if github_repo is not None else issue_github_repo)
    if repo_id:
        repository = project_repository_row(repo_id, tenant_id, project_id)
        if not repository:
            raise HTTPException(status_code=400, detail="Repository does not belong to the selected project")
        if repository.get("status") != "ACTIVE":
            raise HTTPException(status_code=400, detail="Repository is disabled")
        return repository
    if repo_value:
        repository = fetch_one(
            """
            SELECT pr.id, pr.tenant_id, pr.project_id, pr.provider, pr.repo, pr.default_branch, pr.branch_prefix, pr.is_default, pr.status, pr.created_by, pr.created_at, pr.updated_at,
                   p.key AS project_key, p.name AS project_name
            FROM project_repositories pr
            JOIN projects p ON p.id = pr.project_id
            WHERE pr.tenant_id = %s AND pr.project_id = %s AND pr.repo = %s AND pr.status = 'ACTIVE'
            LIMIT 1
            """,
            (tenant_id, project_id, repo_value),
        )
        if repository:
            return repository
        if ai_pickable:
            raise HTTPException(status_code=400, detail="Task repository must be selected before making it AI-pickable")
        return None
    repos = fetch_all(
        """
        SELECT id, tenant_id, project_id, provider, repo, default_branch, branch_prefix, is_default, status, created_by, created_at, updated_at
        FROM project_repositories
        WHERE tenant_id = %s AND project_id = %s AND status = 'ACTIVE'
        ORDER BY is_default DESC, created_at ASC
        """,
        (tenant_id, project_id),
    )
    active_repos = [repo for repo in repos if repo.get("status") == "ACTIVE"]
    if ai_pickable and len(active_repos) > 1:
        raise HTTPException(status_code=400, detail="Task repository must be selected before making it AI-pickable")
    if len(active_repos) == 1 and (ai_pickable or issue_repository_id or repository_id):
        return active_repos[0]
    default_repo = next((repo for repo in active_repos if repo.get("is_default")), None)
    if ai_pickable and default_repo:
        return default_repo
    return None


@router.get("")
def list_issues(
    current_user: dict = Depends(get_current_user),
    project_id: str | None = None,
    sprint_id: str | None = None,
    status: str | None = None,
    assignee_id: str | None = None,
    q: str | None = Query(default=None),
):
    tenant_id = resolve_tenant_id(current_user)
    ensure_workspace_board_defaults(tenant_id)
    params: list[Any] = [tenant_id]
    where = ["i.tenant_id = %s"]
    if project_id:
        where.append("i.project_id = %s")
        params.append(project_id)
    if sprint_id == "null":
        where.append("i.sprint_id IS NULL")
    elif sprint_id:
        where.append("i.sprint_id = %s")
        params.append(sprint_id)
    if status:
        validate_issue_values(status=status)
        where.append("i.status = %s")
        params.append(status)
    if assignee_id:
        where.append("i.assignee_id = %s")
        params.append(assignee_id)
    if q:
        where.append("(i.title ILIKE %s OR i.issue_key ILIKE %s OR i.description ILIKE %s)")
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
    rows = fetch_all(
        f"""
        SELECT {ISSUE_SELECT_COLUMNS},
               p.key AS project_key, au.name AS assignee_name, ru.name AS reporter_name, s.name AS sprint_name
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        LEFT JOIN users au ON au.id = i.assignee_id
        LEFT JOIN users ru ON ru.id = i.reporter_id
        LEFT JOIN sprints s ON s.id = i.sprint_id
        WHERE {' AND '.join(where)}
        ORDER BY i.position ASC, i.created_at DESC
        """,
        tuple(params),
    )
    return {"issues": rows_to_json(rows)}


@router.post("")
async def create_issue(payload: IssueCreate, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    validate_issue_values(payload.issue_type, payload.status, payload.priority)
    ensure_workspace_board_defaults(tenant_id)
    project = ensure_project_for_task(tenant_id, payload.project_id)
    if payload.ai_pickable and not (payload.repository_id or payload.github_repo):
        raise HTTPException(status_code=400, detail="Task repository must be selected before making it AI-pickable")
    repository = None
    if payload.repository_id is not None or payload.github_repo is not None or payload.ai_pickable:
        repository = resolve_task_repository(
            tenant_id,
            project["id"],
            repository_id=payload.repository_id,
            github_repo=payload.github_repo,
            ai_pickable=payload.ai_pickable,
        )
    github_repo = ensure_safe_repo(payload.github_repo) or (repository["repo"] if repository else None)
    repository_id = repository["id"] if repository else None
    sprint_id = payload.sprint_id
    if sprint_id:
        ensure_sprint(sprint_id, tenant_id, project["id"])
    elif payload.status != "BACKLOG":
        sprint = ensure_current_monthly_sprint(tenant_id, project["id"])
        sprint_id = sprint["id"]

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE projects SET issue_counter = issue_counter + 1, updated_at = now() WHERE id = %s AND tenant_id = %s RETURNING issue_counter, key",
                (project["id"], tenant_id),
            )
            counter_row = cur.fetchone()
            issue_key = f"{counter_row['key']}-{counter_row['issue_counter']}"
            cur.execute(
                "SELECT COALESCE(MAX(position), 0) + 1000 AS next_position FROM issues WHERE tenant_id = %s AND project_id = %s AND status = %s",
                (tenant_id, project["id"], payload.status),
            )
            position = cur.fetchone()["next_position"]
            cur.execute(
                """
                INSERT INTO issues (
                    tenant_id, project_id, sprint_id, issue_key, title, description, issue_type, status,
                    priority, ai_pickable, repository_id, github_repo, github_branch, assignee_id, reporter_id, story_points, due_date, labels, position
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (
                    tenant_id,
                    project["id"],
                    sprint_id,
                    issue_key,
                    payload.title.strip(),
                    payload.description,
                    payload.issue_type,
                    payload.status,
                    payload.priority,
                    payload.ai_pickable,
                    repository_id,
                    github_repo,
                    payload.github_branch,
                    payload.assignee_id,
                    current_user["id"],
                    payload.story_points,
                    payload.due_date,
                    payload.labels,
                    position,
                ),
            )
            issue = cur.fetchone()

    record_activity(tenant_id, current_user["id"], "issue_created", f"Created {issue['issue_key']}: {issue['title']}", project_id=project["id"], issue_id=issue["id"])
    await event_bus.publish(tenant_id, "issue_created", {"issue": row_to_json(issue)})
    return {"issue": row_to_json(issue)}


@router.post("/tasks")
async def create_task(payload: IssueCreate, current_user: dict = Depends(get_current_user)):
    return await create_issue(payload, current_user)


@router.patch("/reorder")
async def reorder_issues(payload: ReorderRequest, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    updated_rows = []
    for item in payload.items:
        if item.status:
            validate_issue_values(status=item.status)
        existing = ensure_issue(item.id, tenant_id)
        status = item.status or existing["status"]
        updated = execute(
            "UPDATE issues SET status = %s, position = %s, sprint_id = %s, updated_at = now() WHERE id = %s AND tenant_id = %s RETURNING *",
            (status, item.position, item.sprint_id if item.sprint_id is not None else existing["sprint_id"], item.id, tenant_id),
        )
        updated_rows.append(updated)
    record_activity(tenant_id, current_user["id"], "issues_reordered", f"Reordered {len(updated_rows)} issues", metadata={"count": len(updated_rows)})
    await event_bus.publish(tenant_id, "issues_reordered", {"issues": rows_to_json(updated_rows)})
    return {"issues": rows_to_json(updated_rows)}


@router.get("/{issue_id}")
def get_issue(issue_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    issue = fetch_issue_by_id(issue_id, tenant_id)
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return {"issue": row_to_json(issue)}


@router.get("/key/{issue_key}")
def get_issue_by_key(issue_key: str, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    issue = ensure_issue_by_key(issue_key, tenant_id)
    return {"issue": row_to_json(issue)}


@router.get("/{issue_id}/agent-activity")
def get_issue_agent_activity(issue_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    ensure_issue(issue_id, tenant_id)
    try:
        timeline = fetch_all(
            """
            SELECT *
            FROM automation_events
            WHERE tenant_id = %s AND issue_id = %s
            ORDER BY created_at ASC
            """,
            (tenant_id, issue_id),
        )
        links = fetch_all(
            """
            SELECT *
            FROM external_links
            WHERE tenant_id = %s AND issue_id = %s
            ORDER BY created_at DESC
            """,
            (tenant_id, issue_id),
        )
    except Exception as exc:
        message = str(exc).lower()
        if "does not exist" not in message:
            raise
        timeline = []
        links = []
    return {"timeline": rows_to_json(timeline), "external_links": rows_to_json(links)}


@router.get("/{issue_id}/activity")
def get_issue_activity(issue_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    ensure_issue(issue_id, tenant_id)
    try:
        rows = fetch_all(
            """
            SELECT ae.*, u.name AS actor_name, u.email AS actor_email
            FROM activity_events ae
            LEFT JOIN users u ON u.id = ae.actor_id
            WHERE ae.tenant_id = %s AND ae.issue_id = %s
            ORDER BY ae.created_at ASC
            """,
            (tenant_id, issue_id),
        )
    except Exception as exc:
        message = str(exc).lower()
        if "does not exist" not in message:
            raise
        rows = []
    return {"activity": rows_to_json(rows)}


@router.patch("/{issue_id}")
async def update_issue(issue_id: str, payload: IssueUpdate, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    issue = ensure_issue(issue_id, tenant_id)
    validate_issue_values(payload.issue_type, payload.status, payload.priority)
    target_project_id = payload.project_id or issue["project_id"]
    if payload.project_id is not None:
        ensure_project(payload.project_id, tenant_id)
    if payload.sprint_id is not None:
        ensure_sprint(payload.sprint_id, tenant_id, target_project_id)
    should_resolve_repository = (
        payload.repository_id is not None
        or payload.github_repo is not None
        or (payload.ai_pickable is True and not (issue.get("repository_id") or issue.get("github_repo")))
        or (payload.project_id is not None and payload.project_id != issue["project_id"] and (issue.get("repository_id") or issue.get("github_repo")))
    )
    selected_repository = resolve_task_repository(
        tenant_id,
        target_project_id,
        repository_id=payload.repository_id,
        github_repo=payload.github_repo,
        ai_pickable=payload.ai_pickable if payload.ai_pickable is True else False,
        issue_repository_id=issue.get("repository_id"),
        issue_github_repo=issue.get("github_repo"),
    ) if should_resolve_repository else None
    selected_repo_id = selected_repository["id"] if selected_repository else None
    selected_repo_value = selected_repository["repo"] if selected_repository else (
        ensure_safe_repo(payload.github_repo) if payload.github_repo is not None else (
            issue.get("github_repo") if payload.project_id is None or payload.project_id == issue["project_id"] else None
        )
    )

    data = payload.model_dump(exclude_unset=True)
    if not data:
        return {"issue": row_to_json(issue)}
    if payload.project_id is None or payload.project_id == issue["project_id"]:
        allowed = [
            "title",
            "description",
            "issue_type",
            "status",
            "priority",
            "ai_pickable",
            "repository_id",
            "github_repo",
            "github_branch",
            "github_pr_url",
            "github_pr_number",
            "github_pr_status",
            "agent_summary",
            "agent_test_notes",
            "agent_blocker_reason",
            "sprint_id",
            "assignee_id",
            "story_points",
            "due_date",
            "labels",
            "position",
        ]
        sets = []
        params = []
        for field in allowed:
            if field in data:
                value = data[field]
                if field == "title" and value is not None:
                    value = value.strip()
                if field == "repository_id":
                    value = selected_repo_id
                if field == "github_repo":
                    value = selected_repo_value if selected_repo_value is not None else None
                sets.append(f"{field} = %s")
                params.append(value)
        if "repository_id" not in data and selected_repo_id is not None:
            sets.append("repository_id = %s")
            params.append(selected_repo_id)
        if "github_repo" not in data and selected_repo_value is not None:
            sets.append("github_repo = %s")
            params.append(selected_repo_value)
        params.extend([issue_id, tenant_id])
        updated = execute(
            f"UPDATE issues SET {', '.join(sets)}, updated_at = now() WHERE id = %s AND tenant_id = %s RETURNING *",
            tuple(params),
        )
    else:
        project = ensure_project(payload.project_id, tenant_id)
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE projects SET issue_counter = issue_counter + 1, updated_at = now() WHERE id = %s AND tenant_id = %s RETURNING issue_counter, key",
                    (project["id"], tenant_id),
                )
                counter_row = cur.fetchone()
                new_issue_key = f"{counter_row['key']}-{counter_row['issue_counter']}"
                sprint_id = payload.sprint_id
                if sprint_id is not None:
                    ensure_sprint(sprint_id, tenant_id, project["id"])
                elif data.get("status", issue["status"]) != "BACKLOG":
                    sprint = ensure_current_monthly_sprint(tenant_id, project["id"])
                    sprint_id = sprint["id"]
                if selected_repository:
                    selected_repo_id_value = selected_repository["id"]
                    selected_repo_value_value = selected_repository["repo"]
                else:
                    selected_repo_id_value = None
                    selected_repo_value_value = ensure_safe_repo(payload.github_repo) if payload.github_repo is not None else (
                        issue.get("github_repo") if issue.get("github_repo") and payload.project_id is None else None
                    )
                sets = ["project_id = %s", "issue_key = %s"]
                params = [project["id"], new_issue_key]
                if "title" in data:
                    sets.append("title = %s")
                    params.append(data["title"].strip() if data["title"] is not None else None)
                for field in ["description", "issue_type", "status", "priority", "repository_id", "github_repo", "sprint_id", "assignee_id", "story_points", "due_date", "labels", "position"]:
                    if field in data:
                        value = data[field]
                        if field == "sprint_id" and value is None:
                            value = None
                        if field == "repository_id":
                            value = selected_repo_id_value
                        if field == "github_repo":
                            value = selected_repo_value_value
                        sets.append(f"{field} = %s")
                        params.append(value)
                if "sprint_id" not in data:
                    sets.append("sprint_id = %s")
                    params.append(sprint_id)
                if "repository_id" not in data and selected_repo_id_value is not None:
                    sets.append("repository_id = %s")
                    params.append(selected_repo_id_value)
                if "github_repo" not in data and selected_repo_value_value is not None:
                    sets.append("github_repo = %s")
                    params.append(selected_repo_value_value)
                params.extend([issue_id, tenant_id])
                cur.execute(
                    f"UPDATE issues SET {', '.join(sets)}, updated_at = now() WHERE id = %s AND tenant_id = %s RETURNING *",
                    tuple(params),
                )
                updated = cur.fetchone()
    record_activity(tenant_id, current_user["id"], "issue_updated", f"Updated {updated['issue_key']}", project_id=updated["project_id"], issue_id=issue_id, metadata=data)
    await event_bus.publish(tenant_id, "issue_updated", {"issue": row_to_json(updated), "changes": data})
    return {"issue": row_to_json(updated)}


@router.delete("/{issue_id}")
async def delete_issue(issue_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    issue = execute("DELETE FROM issues WHERE id = %s AND tenant_id = %s RETURNING *", (issue_id, tenant_id))
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    record_activity(tenant_id, current_user["id"], "issue_deleted", f"Deleted {issue['issue_key']}", project_id=issue["project_id"], metadata={"issue_id": issue_id})
    await event_bus.publish(tenant_id, "issue_deleted", {"issue_id": issue_id})
    return {"ok": True}


@router.patch("/{issue_id}/status")
async def update_status(issue_id: str, payload: StatusUpdate, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    validate_issue_values(status=payload.status)
    issue = ensure_issue(issue_id, tenant_id)
    position = payload.position
    if position is None:
        row = fetch_one("SELECT COALESCE(MAX(position), 0) + 1000 AS next_position FROM issues WHERE tenant_id = %s AND project_id = %s AND status = %s", (tenant_id, issue["project_id"], payload.status))
        position = row["next_position"]
    updated = execute(
        "UPDATE issues SET status = %s, position = %s, updated_at = now() WHERE id = %s AND tenant_id = %s RETURNING *",
        (payload.status, position, issue_id, tenant_id),
    )
    record_activity(tenant_id, current_user["id"], "issue_status_changed", f"Moved {updated['issue_key']} to {payload.status}", project_id=updated["project_id"], issue_id=issue_id, metadata={"from": issue["status"], "to": payload.status})
    await event_bus.publish(tenant_id, "issue_updated", {"issue": row_to_json(updated), "changes": {"status": payload.status, "position": position}})
    return {"issue": row_to_json(updated)}


@router.patch("/{issue_id}/sprint")
async def update_sprint(issue_id: str, payload: SprintAssignment, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    issue = ensure_issue(issue_id, tenant_id)
    ensure_sprint(payload.sprint_id, tenant_id, issue["project_id"])
    status = payload.status or ("TODO" if payload.sprint_id and issue["status"] == "BACKLOG" else issue["status"])
    validate_issue_values(status=status)
    updated = execute(
        "UPDATE issues SET sprint_id = %s, status = %s, updated_at = now() WHERE id = %s AND tenant_id = %s RETURNING *",
        (payload.sprint_id, status, issue_id, tenant_id),
    )
    record_activity(tenant_id, current_user["id"], "issue_sprint_changed", f"Changed sprint for {updated['issue_key']}", project_id=updated["project_id"], issue_id=issue_id, sprint_id=payload.sprint_id)
    await event_bus.publish(tenant_id, "issue_updated", {"issue": row_to_json(updated), "changes": {"sprint_id": payload.sprint_id, "status": status}})
    return {"issue": row_to_json(updated)}
