from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Any
from ..database import fetch_all, fetch_one, execute, get_conn
from ..security import get_current_user
from ..utils import row_to_json, rows_to_json
from ..services.activity import record_activity
from ..services.workspace_defaults import ensure_workspace_board_defaults, ensure_default_project, ensure_current_monthly_sprint
from ..sse import event_bus

router = APIRouter(prefix="/api/issues", tags=["issues"])

VALID_STATUSES = {"BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "BLOCKED"}
VALID_TYPES = {"TASK", "BUG", "STORY", "EPIC", "IMPROVEMENT"}
VALID_PRIORITIES = {"LOW", "MEDIUM", "HIGH", "URGENT"}


class IssueCreate(BaseModel):
    project_id: str | None = None
    title: str = Field(min_length=1, max_length=240)
    description: str = ""
    issue_type: str = "TASK"
    status: str = "BACKLOG"
    priority: str = "MEDIUM"
    sprint_id: str | None = None
    assignee_id: str | None = None
    story_points: int = Field(default=0, ge=0, le=100)
    due_date: str | None = None
    labels: list[str] = []


class IssueUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=240)
    description: str | None = None
    issue_type: str | None = None
    status: str | None = None
    priority: str | None = None
    project_id: str | None = None
    sprint_id: str | None = None
    assignee_id: str | None = None
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
    project = fetch_one("SELECT * FROM projects WHERE id = %s AND tenant_id = %s", (project_id, tenant_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def ensure_issue(issue_id: str, tenant_id: str):
    issue = fetch_one("SELECT * FROM issues WHERE id = %s AND tenant_id = %s", (issue_id, tenant_id))
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


def ensure_sprint(sprint_id: str | None, tenant_id: str, project_id: str):
    if not sprint_id:
        return None
    sprint = fetch_one("SELECT * FROM sprints WHERE id = %s AND tenant_id = %s AND project_id = %s", (sprint_id, tenant_id, project_id))
    if not sprint:
        raise HTTPException(status_code=404, detail="Sprint not found")
    return sprint


def ensure_project_for_task(tenant_id: str, project_id: str | None):
    if project_id:
        return ensure_project(project_id, tenant_id)
    return ensure_default_project(tenant_id)


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
        SELECT i.*, p.key AS project_key, au.name AS assignee_name, ru.name AS reporter_name, s.name AS sprint_name
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
                    priority, assignee_id, reporter_id, story_points, due_date, labels, position
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
    issue = fetch_one(
        """
        SELECT i.*, p.key AS project_key, au.name AS assignee_name, ru.name AS reporter_name, s.name AS sprint_name
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        LEFT JOIN users au ON au.id = i.assignee_id
        LEFT JOIN users ru ON ru.id = i.reporter_id
        LEFT JOIN sprints s ON s.id = i.sprint_id
        WHERE i.id = %s AND i.tenant_id = %s
        """,
        (issue_id, tenant_id),
    )
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return {"issue": row_to_json(issue)}


@router.patch("/{issue_id}")
async def update_issue(issue_id: str, payload: IssueUpdate, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    issue = ensure_issue(issue_id, tenant_id)
    validate_issue_values(payload.issue_type, payload.status, payload.priority)
    if payload.project_id is not None:
        ensure_project(payload.project_id, tenant_id)
    if payload.sprint_id is not None:
        ensure_sprint(payload.sprint_id, tenant_id, issue["project_id"])

    data = payload.model_dump(exclude_unset=True)
    if not data:
        return {"issue": row_to_json(issue)}
    if payload.project_id is None or payload.project_id == issue["project_id"]:
        allowed = ["title", "description", "issue_type", "status", "priority", "sprint_id", "assignee_id", "story_points", "due_date", "labels", "position"]
        sets = []
        params = []
        for field in allowed:
            if field in data:
                value = data[field]
                if field == "title" and value is not None:
                    value = value.strip()
                sets.append(f"{field} = %s")
                params.append(value)
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
                sets = ["project_id = %s", "issue_key = %s"]
                params = [project["id"], new_issue_key]
                if "title" in data:
                    sets.append("title = %s")
                    params.append(data["title"].strip() if data["title"] is not None else None)
                for field in ["description", "issue_type", "status", "priority", "sprint_id", "assignee_id", "story_points", "due_date", "labels", "position"]:
                    if field in data:
                        value = data[field]
                        if field == "sprint_id" and value is None:
                            value = None
                        sets.append(f"{field} = %s")
                        params.append(value)
                if "sprint_id" not in data:
                    sets.append("sprint_id = %s")
                    params.append(sprint_id)
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
