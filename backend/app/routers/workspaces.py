from fastapi import APIRouter, Depends
from ..security import get_current_user
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
