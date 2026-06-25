from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from ..database import fetch_all, fetch_one, execute, get_conn
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


def resolve_tenant_id(current_user: dict) -> str:
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Workspace not selected")
    return str(tenant_id)


@lru_cache(maxsize=1)
def _project_repositories_has_github_repository_id() -> bool:
    try:
        row = fetch_one(
            """
            SELECT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'project_repositories'
                  AND column_name = 'github_repository_id'
            ) AS present
            """
        )
        return bool(row and row.get("present"))
    except Exception:
        return False


def _repository_select_fragment() -> str:
    if _project_repositories_has_github_repository_id():
        return """
               pr.github_repository_id, gr.full_name AS github_full_name, gr.visibility AS github_visibility, gr.default_branch AS github_default_branch,
        """
    return """
               NULL::uuid AS github_repository_id, NULL::text AS github_full_name, NULL::text AS github_visibility, NULL::text AS github_default_branch,
    """


def _repository_join_fragment() -> str:
    if _project_repositories_has_github_repository_id():
        return "LEFT JOIN github_repositories gr ON gr.id = pr.github_repository_id"
    return ""


def _repository_insert_columns() -> str:
    if _project_repositories_has_github_repository_id():
        return "(tenant_id, project_id, provider, repo, default_branch, branch_prefix, is_default, created_by, github_repository_id)"
    return "(tenant_id, project_id, provider, repo, default_branch, branch_prefix, is_default, created_by)"


def _repository_insert_values() -> str:
    if _project_repositories_has_github_repository_id():
        return "%s, %s, %s, %s, %s, %s, %s, %s, %s"
    return "%s, %s, %s, %s, %s, %s, %s, %s"


def _repository_insert_params(payload: ProjectRepositoryCreate, tenant_id: str, project_id: str, current_user: dict, github_repo: dict | None, repo: str) -> tuple:
    default_branch = (payload.default_branch.strip() if payload.default_branch else "") or (github_repo["default_branch"] if github_repo else "main")
    base_params = (
        tenant_id,
        project_id,
        payload.provider,
        repo,
        default_branch,
        payload.branch_prefix.strip(),
        payload.is_default,
        current_user["id"],
    )
    if _project_repositories_has_github_repository_id():
        return base_params + (payload.github_repository_id,)
    return base_params


@router.get("")
def list_projects(current_user: dict = Depends(get_current_user), include_archived: bool = False):
    tenant_id = resolve_tenant_id(current_user)
    if include_archived:
        rows = fetch_all("SELECT id, tenant_id, name, key, description, visibility, status, issue_counter, created_by, created_at, updated_at FROM projects WHERE tenant_id = %s ORDER BY created_at DESC", (tenant_id,))
    else:
        rows = fetch_all("SELECT id, tenant_id, name, key, description, visibility, status, issue_counter, created_by, created_at, updated_at FROM projects WHERE tenant_id = %s AND status != 'ARCHIVED' ORDER BY created_at DESC", (tenant_id,))
    return {"projects": rows_to_json(rows)}


@router.post("")
async def create_project(payload: ProjectCreate, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    key = project_key(payload.key or payload.name)
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO projects (tenant_id, name, key, description, visibility, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (tenant_id, key)
                    DO NOTHING
                    RETURNING *
                    """,
                    (tenant_id, payload.name.strip(), key, payload.description, payload.visibility, current_user["id"]),
                )
                project = cur.fetchone()
                if not project:
                    cur.execute("SELECT id, tenant_id, name, key, description, visibility, status, issue_counter, created_by, created_at, updated_at FROM projects WHERE tenant_id = %s AND key = %s LIMIT 1", (tenant_id, key))
                    project = cur.fetchone()
    except Exception as exc:
        code = getattr(exc, "sqlstate", None)
        if code == "23505":
            raise HTTPException(status_code=409, detail="Project key already exists in this tenant")
        raise
    if not project:
        raise HTTPException(status_code=500, detail="Project creation failed")
    record_activity(tenant_id, current_user["id"], "project_created", f"Created project {project['key']}", project_id=project["id"])
    await event_bus.publish(str(tenant_id), "project_created", {"project": row_to_json(project)})
    return {"project": row_to_json(project)}


@router.get("/{project_id}")
def get_project(project_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    project = fetch_one("SELECT id, tenant_id, name, key, description, visibility, status, issue_counter, created_by, created_at, updated_at FROM projects WHERE id = %s AND tenant_id = %s", (project_id, tenant_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": row_to_json(project)}


@router.patch("/{project_id}")
async def update_project(project_id: str, payload: ProjectUpdate, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    project = fetch_one("SELECT id, tenant_id, name, key, description, visibility, status, issue_counter, created_by, created_at, updated_at FROM projects WHERE id = %s AND tenant_id = %s", (project_id, tenant_id))
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
        (name, description, status, visibility, project_id, tenant_id),
    )
    record_activity(tenant_id, current_user["id"], "project_updated", f"Updated project {updated['key']}", project_id=project_id)
    await event_bus.publish(str(tenant_id), "project_updated", {"project": row_to_json(updated)})
    return {"project": row_to_json(updated)}


@router.delete("/{project_id}")
async def archive_project(project_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    project = fetch_one("SELECT id, tenant_id, name, key, description, visibility, status, issue_counter, created_by, created_at, updated_at FROM projects WHERE id = %s AND tenant_id = %s", (project_id, tenant_id))
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
        (project_id, tenant_id, current_user["role"], current_user["id"]),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Project not found")
    record_activity(tenant_id, current_user["id"], "project_archived", f"Archived project {updated['key']}", project_id=project_id)
    await event_bus.publish(str(tenant_id), "project_archived", {"project_id": project_id})
    return {"ok": True}
