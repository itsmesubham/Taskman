from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from ..database import fetch_all, fetch_one, execute, get_conn
from ..security import get_current_user, require_role
from ..utils import row_to_json, rows_to_json
from ..services.activity import record_activity
from ..services.agent_workflow import ISSUE_SELECT_COLUMNS
from ..services.workspace_defaults import ensure_workspace_board_defaults, get_workspace_sprint_schedule
from ..sse import event_bus

router = APIRouter(prefix="/api/sprints", tags=["sprints"])

VALID_STATUS = {"PLANNED", "ACTIVE", "COMPLETED"}


class SprintCreate(BaseModel):
    project_id: str
    name: str = Field(min_length=1, max_length=160)
    goal: str = ""
    start_date: str | None = None
    end_date: str | None = None


class SprintUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=160)
    goal: str | None = None
    status: str | None = None
    start_date: str | None = None
    end_date: str | None = None


class SprintIssueRequest(BaseModel):
    issue_ids: list[str]


class CompleteSprintRequest(BaseModel):
    incomplete_strategy: str = Field(default="BACKLOG", pattern="^(BACKLOG|KEEP)$")


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


def ensure_sprint(sprint_id: str, tenant_id: str):
    sprint = fetch_one(
        "SELECT id, tenant_id, project_id, name, goal, status, start_date, end_date, created_by, created_at, updated_at FROM sprints WHERE id = %s AND tenant_id = %s",
        (sprint_id, tenant_id),
    )
    if not sprint:
        raise HTTPException(status_code=404, detail="Sprint not found")
    return sprint


@router.get("")
def list_sprints(current_user: dict = Depends(get_current_user), project_id: str | None = None, status: str | None = None):
    tenant_id = resolve_tenant_id(current_user)
    params = [tenant_id]
    where = ["s.tenant_id = %s"]
    if project_id:
        where.append("s.project_id = %s")
        params.append(project_id)
    if status:
        if status not in VALID_STATUS:
            raise HTTPException(status_code=400, detail="Invalid sprint status")
        where.append("s.status = %s")
        params.append(status)
    rows = fetch_all(
        f"""
        SELECT s.id, s.tenant_id, s.project_id, s.name, s.goal, s.status, s.start_date, s.end_date, s.created_by, s.created_at, s.updated_at,
               p.key AS project_key, p.name AS project_name,
               COUNT(i.id) AS issue_count,
               COUNT(i.id) FILTER (WHERE i.status = 'DONE') AS done_count,
               COALESCE(SUM(i.story_points), 0) AS total_points,
               COALESCE(SUM(i.story_points) FILTER (WHERE i.status = 'DONE'), 0) AS done_points
        FROM sprints s
        JOIN projects p ON p.id = s.project_id
        LEFT JOIN issues i ON i.sprint_id = s.id
        WHERE {' AND '.join(where)}
        GROUP BY s.id, p.key, p.name
        ORDER BY s.created_at DESC
        """,
        tuple(params),
    )
    return {"sprints": rows_to_json(rows)}


@router.get("/schedule")
def sprint_schedule(current_user: dict = Depends(get_current_user), project_id: str | None = None):
    tenant_id = resolve_tenant_id(current_user)
    ensure_workspace_board_defaults(tenant_id)
    return get_workspace_sprint_schedule(tenant_id, project_id)


@router.post("")
async def create_sprint(payload: SprintCreate, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    ensure_project(payload.project_id, tenant_id)
    sprint = execute(
        """
        INSERT INTO sprints (tenant_id, project_id, name, goal, start_date, end_date, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (tenant_id, payload.project_id, payload.name.strip(), payload.goal, payload.start_date, payload.end_date, current_user["id"]),
    )
    record_activity(tenant_id, current_user["id"], "sprint_created", f"Created sprint {sprint['name']}", project_id=payload.project_id, sprint_id=sprint["id"])
    await event_bus.publish(tenant_id, "sprint_created", {"sprint": row_to_json(sprint)})
    return {"sprint": row_to_json(sprint)}


@router.get("/{sprint_id}")
def get_sprint(sprint_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    sprint = ensure_sprint(sprint_id, tenant_id)
    issues = fetch_all(
        f"SELECT {ISSUE_SELECT_COLUMNS} FROM issues WHERE sprint_id = %s AND tenant_id = %s ORDER BY position ASC",
        (sprint_id, tenant_id),
    )
    return {"sprint": row_to_json(sprint), "issues": rows_to_json(issues)}


@router.patch("/{sprint_id}")
async def update_sprint(sprint_id: str, payload: SprintUpdate, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    sprint = ensure_sprint(sprint_id, tenant_id)
    data = payload.model_dump(exclude_unset=True)
    if payload.status and payload.status not in VALID_STATUS:
        raise HTTPException(status_code=400, detail="Invalid sprint status")
    if not data:
        return {"sprint": row_to_json(sprint)}
    sets = []
    params = []
    for field in ["name", "goal", "status", "start_date", "end_date"]:
        if field in data:
            value = data[field]
            if field == "name" and value is not None:
                value = value.strip()
            sets.append(f"{field} = %s")
            params.append(value)
    params.extend([sprint_id, tenant_id])
    updated = execute(
        f"UPDATE sprints SET {', '.join(sets)}, updated_at = now() WHERE id = %s AND tenant_id = %s RETURNING *",
        tuple(params),
    )
    record_activity(tenant_id, current_user["id"], "sprint_updated", f"Updated sprint {updated['name']}", project_id=updated["project_id"], sprint_id=sprint_id, metadata=data)
    await event_bus.publish(tenant_id, "sprint_updated", {"sprint": row_to_json(updated), "changes": data})
    return {"sprint": row_to_json(updated)}


@router.post("/{sprint_id}/start")
async def start_sprint(sprint_id: str, current_user: dict = Depends(require_role("OWNER", "ADMIN", "MEMBER"))):
    tenant_id = resolve_tenant_id(current_user)
    sprint = ensure_sprint(sprint_id, tenant_id)
    active = fetch_one("SELECT id FROM sprints WHERE tenant_id = %s AND project_id = %s AND status = 'ACTIVE' AND id != %s", (tenant_id, sprint["project_id"], sprint_id))
    if active:
        raise HTTPException(status_code=409, detail="Another sprint is already active for this project")
    updated = execute("UPDATE sprints SET status = 'ACTIVE', updated_at = now() WHERE id = %s AND tenant_id = %s RETURNING *", (sprint_id, tenant_id))
    if not updated:
        raise HTTPException(status_code=500, detail="Unable to start sprint")
    execute("UPDATE issues SET status = 'TODO', updated_at = now() WHERE sprint_id = %s AND tenant_id = %s AND status = 'BACKLOG'", (sprint_id, tenant_id))
    record_activity(tenant_id, current_user["id"], "sprint_started", f"Started sprint {updated['name']}", project_id=updated["project_id"], sprint_id=sprint_id)
    await event_bus.publish(tenant_id, "sprint_started", {"sprint": row_to_json(updated)})
    return {"sprint": row_to_json(updated)}


@router.post("/{sprint_id}/complete")
async def complete_sprint(sprint_id: str, payload: CompleteSprintRequest = CompleteSprintRequest(), current_user: dict = Depends(require_role("OWNER", "ADMIN"))):
    tenant_id = resolve_tenant_id(current_user)
    sprint = ensure_sprint(sprint_id, tenant_id)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE sprints SET status = 'COMPLETED', updated_at = now() WHERE id = %s AND tenant_id = %s RETURNING *", (sprint_id, tenant_id))
            updated = cur.fetchone()
            moved_count = 0
            if payload.incomplete_strategy == "BACKLOG":
                cur.execute(
                    """
                    UPDATE issues
                    SET sprint_id = NULL, status = 'BACKLOG', updated_at = now()
                    WHERE sprint_id = %s AND tenant_id = %s AND status != 'DONE'
                    RETURNING id
                    """,
                    (sprint_id, tenant_id),
                )
                moved_count = len(cur.fetchall())
    record_activity(tenant_id, current_user["id"], "sprint_completed", f"Completed sprint {updated['name']}", project_id=updated["project_id"], sprint_id=sprint_id, metadata={"moved_incomplete_to_backlog": moved_count})
    await event_bus.publish(tenant_id, "sprint_completed", {"sprint": row_to_json(updated), "moved_incomplete_to_backlog": moved_count})
    return {"sprint": row_to_json(updated), "moved_incomplete_to_backlog": moved_count}


@router.post("/{sprint_id}/issues")
async def add_issues_to_sprint(sprint_id: str, payload: SprintIssueRequest, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    sprint = ensure_sprint(sprint_id, tenant_id)
    updated_rows = []
    for issue_id in payload.issue_ids:
        updated = execute(
            """
            UPDATE issues
            SET sprint_id = %s,
                status = CASE WHEN status = 'BACKLOG' THEN 'TODO' ELSE status END,
                updated_at = now()
            WHERE id = %s AND tenant_id = %s AND project_id = %s
            RETURNING *
            """,
            (sprint_id, issue_id, tenant_id, sprint["project_id"]),
        )
        if updated:
            updated_rows.append(updated)
    record_activity(tenant_id, current_user["id"], "issues_added_to_sprint", f"Added {len(updated_rows)} issues to sprint {sprint['name']}", project_id=sprint["project_id"], sprint_id=sprint_id, metadata={"count": len(updated_rows)})
    await event_bus.publish(tenant_id, "issues_added_to_sprint", {"sprint_id": sprint_id, "issues": rows_to_json(updated_rows)})
    return {"issues": rows_to_json(updated_rows)}
