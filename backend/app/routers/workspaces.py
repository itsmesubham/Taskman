from fastapi import APIRouter, Depends, HTTPException
from ..security import get_current_user
from ..database import fetch_one
from ..services.memberships import memberships_for_user
from ..services.agent_workflow import ISSUE_SELECT_COLUMNS
from ..utils import row_to_json
from ..services.workspace_defaults import ensure_workspace_board_defaults, get_workspace_sprint_schedule

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


@router.get("/board")
def board_defaults(current_user: dict = Depends(get_current_user)):
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    defaults = ensure_workspace_board_defaults(tenant_id)
    return defaults


@router.get("/schedule")
def schedule(current_user: dict = Depends(get_current_user)):
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    return get_workspace_sprint_schedule(tenant_id)


@router.get("/{workspace_slug}/tasks/{task_key}")
def get_workspace_task(workspace_slug: str, task_key: str, current_user: dict = Depends(get_current_user)):
    user_memberships = memberships_for_user(str(current_user["id"]))
    membership = next((row for row in user_memberships if row.get("tenant_slug") == workspace_slug), None)
    if not membership:
        raise HTTPException(status_code=403, detail="Cannot access this workspace")
    issue = fetch_one(
        f"""
        SELECT {ISSUE_SELECT_COLUMNS},
               p.key AS project_key, au.name AS assignee_name, ru.name AS reporter_name, s.name AS sprint_name
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        LEFT JOIN users au ON au.id = i.assignee_id
        LEFT JOIN users ru ON ru.id = i.reporter_id
        LEFT JOIN sprints s ON s.id = i.sprint_id
        WHERE i.tenant_id = %s AND i.issue_key = %s
        """,
        (membership["tenant_id"], task_key),
    )
    if not issue:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"issue": row_to_json(issue)}
