from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from ..database import fetch_all, fetch_one, execute
from ..security import get_current_user, require_role
from ..utils import row_to_json, rows_to_json, project_key
from ..services.activity import record_activity
from ..sse import event_bus

router = APIRouter(prefix="/api/projects", tags=["projects"])


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    key: str | None = Field(default=None, max_length=20)
    description: str = ""
    visibility: str = Field(default="EVERYONE", pattern="^(EVERYONE|SOME_USERS|PRIVATE)$")


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=160)
    description: str | None = None
    status: str | None = Field(default=None, pattern="^(ACTIVE|ARCHIVED)$")
    visibility: str | None = Field(default=None, pattern="^(EVERYONE|SOME_USERS|PRIVATE)$")


@router.get("")
def list_projects(current_user: dict = Depends(get_current_user), include_archived: bool = False):
    if include_archived:
        rows = fetch_all("SELECT * FROM projects WHERE tenant_id = %s ORDER BY created_at DESC", (current_user["tenant_id"],))
    else:
        rows = fetch_all("SELECT * FROM projects WHERE tenant_id = %s AND status != 'ARCHIVED' ORDER BY created_at DESC", (current_user["tenant_id"],))
    return {"projects": rows_to_json(rows)}


@router.post("")
async def create_project(payload: ProjectCreate, current_user: dict = Depends(get_current_user)):
    key = project_key(payload.key or payload.name)
    existing = fetch_one("SELECT id FROM projects WHERE tenant_id = %s AND key = %s", (current_user["tenant_id"], key))
    if existing:
        raise HTTPException(status_code=409, detail="Project key already exists in this tenant")
    project = execute(
        """
        INSERT INTO projects (tenant_id, name, key, description, visibility, created_by)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (current_user["tenant_id"], payload.name.strip(), key, payload.description, payload.visibility, current_user["id"]),
    )
    record_activity(current_user["tenant_id"], current_user["id"], "project_created", f"Created project {project['key']}", project_id=project["id"])
    await event_bus.publish(str(current_user["tenant_id"]), "project_created", {"project": row_to_json(project)})
    return {"project": row_to_json(project)}


@router.get("/{project_id}")
def get_project(project_id: str, current_user: dict = Depends(get_current_user)):
    project = fetch_one("SELECT * FROM projects WHERE id = %s AND tenant_id = %s", (project_id, current_user["tenant_id"]))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": row_to_json(project)}


@router.patch("/{project_id}")
async def update_project(project_id: str, payload: ProjectUpdate, current_user: dict = Depends(get_current_user)):
    project = fetch_one("SELECT * FROM projects WHERE id = %s AND tenant_id = %s", (project_id, current_user["tenant_id"]))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if current_user["role"] not in ("OWNER", "ADMIN") and project.get("created_by") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    name = payload.name.strip() if payload.name is not None else project["name"]
    description = payload.description if payload.description is not None else project["description"]
    status = payload.status if payload.status is not None else project["status"]
    visibility = payload.visibility if payload.visibility is not None else project.get("visibility", "EVERYONE")
    updated = execute(
        """
        UPDATE projects SET name = %s, description = %s, status = %s, visibility = %s, updated_at = now()
        WHERE id = %s AND tenant_id = %s
        RETURNING *
        """,
        (name, description, status, visibility, project_id, current_user["tenant_id"]),
    )
    record_activity(current_user["tenant_id"], current_user["id"], "project_updated", f"Updated project {updated['key']}", project_id=project_id)
    await event_bus.publish(str(current_user["tenant_id"]), "project_updated", {"project": row_to_json(updated)})
    return {"project": row_to_json(updated)}


@router.delete("/{project_id}")
async def archive_project(project_id: str, current_user: dict = Depends(get_current_user)):
    project = fetch_one("SELECT * FROM projects WHERE id = %s AND tenant_id = %s", (project_id, current_user["tenant_id"]))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if current_user["role"] not in ("OWNER", "ADMIN") and project.get("created_by") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    updated = execute(
        """
        UPDATE projects
        SET status = 'ARCHIVED', updated_at = now()
        WHERE id = %s
          AND tenant_id = %s
          AND (%s IN ('OWNER', 'ADMIN') OR created_by = %s)
        RETURNING *
        """,
        (project_id, current_user["tenant_id"], current_user["role"], current_user["id"]),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    record_activity(current_user["tenant_id"], current_user["id"], "project_archived", f"Archived project {updated['key']}", project_id=project_id)
    await event_bus.publish(str(current_user["tenant_id"]), "project_archived", {"project_id": project_id})
    return {"ok": True}
