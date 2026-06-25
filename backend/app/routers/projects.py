from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from ..database import fetch_all, fetch_one, execute, get_conn
from ..security import get_current_user, require_role
from ..utils import row_to_json, rows_to_json, project_key
from ..services.activity import record_activity
from ..services.github import github_repository_by_id
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


class ProjectRepositoryCreate(BaseModel):
    provider: str = Field(default="github", pattern="^github$")
    repo: str | None = Field(default=None, max_length=200)
    github_repository_id: str | None = None
    default_branch: str = Field(default="main", max_length=120)
    branch_prefix: str = Field(default="", max_length=120)
    is_default: bool = False


class ProjectRepositoryUpdate(BaseModel):
    default_branch: str | None = Field(default=None, max_length=120)
    branch_prefix: str | None = Field(default=None, max_length=120)
    is_default: bool | None = None
    status: str | None = Field(default=None, pattern="^(ACTIVE|DISABLED)$")


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


def ensure_project(project_id: str, tenant_id: str):
    project = fetch_one(
        "SELECT id, tenant_id, name, key, description, visibility, status, issue_counter, created_by, created_at, updated_at FROM projects WHERE id = %s AND tenant_id = %s",
        (project_id, tenant_id),
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def ensure_project_permissions(project: dict, current_user: dict):
    if current_user["role"] not in ("OWNER", "ADMIN") and project.get("created_by") != current_user["id"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")


def ensure_project_repository(project_repository_id: str, tenant_id: str, project_id: str | None = None):
    params = [tenant_id, project_repository_id]
    where = ["pr.tenant_id = %s", "pr.id = %s"]
    if project_id:
        where.append("pr.project_id = %s")
        params.append(project_id)
    select_fragment = _repository_select_fragment()
    join_fragment = _repository_join_fragment()
    repository = fetch_one(
        f"""
        SELECT pr.id, pr.tenant_id, pr.project_id, pr.provider, pr.repo, pr.default_branch, pr.branch_prefix, pr.is_default, pr.status, pr.created_by, pr.created_at, pr.updated_at,
               {select_fragment}
               p.key AS project_key, p.name AS project_name
        FROM project_repositories pr
        JOIN projects p ON p.id = pr.project_id
        {join_fragment}
        WHERE {' AND '.join(where)}
        """,
        tuple(params),
    )
    if not repository:
        raise HTTPException(status_code=404, detail="Repository not found")
    return repository


@router.get("")
def list_projects(current_user: dict = Depends(get_current_user), include_archived: bool = False):
    tenant_id = resolve_tenant_id(current_user)
    if include_archived:
        rows = fetch_all("SELECT id, tenant_id, name, key, description, visibility, status, issue_counter, created_by, created_at, updated_at FROM projects WHERE tenant_id = %s ORDER BY created_at DESC", (tenant_id,))
    else:
        rows = fetch_all("SELECT id, tenant_id, name, key, description, visibility, status, issue_counter, created_by, created_at, updated_at FROM projects WHERE tenant_id = %s AND status != 'ARCHIVED' ORDER BY created_at DESC", (tenant_id,))
    return {"projects": rows_to_json(rows)}


@router.get("/repositories")
def list_project_repositories(current_user: dict = Depends(get_current_user), project_id: str | None = None):
    tenant_id = resolve_tenant_id(current_user)
    params = [tenant_id]
    project_filter = ""
    if project_id:
        project_filter = "AND pr.project_id = %s"
        params.append(project_id)
    select_fragment = _repository_select_fragment()
    join_fragment = _repository_join_fragment()
    rows = fetch_all(
        f"""
        SELECT pr.id, pr.tenant_id, pr.project_id, pr.provider, pr.repo, pr.default_branch, pr.branch_prefix, pr.is_default, pr.status, pr.created_by, pr.created_at, pr.updated_at,
               {select_fragment}
               p.key AS project_key, p.name AS project_name,
               COALESCE(task_counts.task_count, 0) AS linked_task_count
        FROM project_repositories pr
        JOIN projects p ON p.id = pr.project_id
        {join_fragment}
        LEFT JOIN (
            SELECT repository_id, COUNT(*)::int AS task_count
            FROM issues
            WHERE tenant_id = %s AND repository_id IS NOT NULL
            GROUP BY repository_id
        ) task_counts ON task_counts.repository_id = pr.id
        WHERE pr.tenant_id = %s {project_filter}
        ORDER BY p.name ASC, pr.is_default DESC, pr.created_at ASC
        """,
        tuple([tenant_id] + params),
    )
    return {"repositories": rows_to_json(rows)}


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


@router.post("/{project_id}/repositories")
async def create_project_repository(project_id: str, payload: ProjectRepositoryCreate, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    project = ensure_project(project_id, tenant_id)
    ensure_project_permissions(project, current_user)
    github_repo = None
    repo = payload.repo.strip() if payload.repo else ""
    if payload.github_repository_id:
        github_repo = github_repository_by_id(tenant_id, payload.github_repository_id)
        if not github_repo:
            raise HTTPException(status_code=404, detail="Repository not found")
        if str(github_repo["tenant_id"]) != tenant_id:
            raise HTTPException(status_code=403, detail="Repository is outside this workspace")
        if github_repo.get("status") != "ACTIVE":
            raise HTTPException(status_code=400, detail="GitHub repository is disabled")
        repo = github_repo["full_name"]
    if not repo or "/" not in repo:
        raise HTTPException(status_code=400, detail="GitHub repo must use owner/name format")
    insert_columns = _repository_insert_columns()
    insert_values = _repository_insert_values()
    insert_params = _repository_insert_params(payload, tenant_id, project_id, current_user, github_repo, repo)
    with get_conn() as conn:
        with conn.cursor() as cur:
            if payload.is_default:
                cur.execute("UPDATE project_repositories SET is_default = false, updated_at = now() WHERE tenant_id = %s AND project_id = %s", (tenant_id, project_id))
            cur.execute(
                f"""
                INSERT INTO project_repositories {insert_columns}
                VALUES ({insert_values})
                ON CONFLICT (tenant_id, project_id, provider, repo)
                DO UPDATE SET
                    default_branch = EXCLUDED.default_branch,
                    branch_prefix = EXCLUDED.branch_prefix,
                    is_default = CASE WHEN EXCLUDED.is_default THEN true ELSE project_repositories.is_default END,
                    status = 'ACTIVE',
                    updated_at = now()
                RETURNING *
                """,
                insert_params,
            )
            repository = cur.fetchone()
            if payload.is_default:
                cur.execute(
                    "UPDATE project_repositories SET is_default = (id = %s), updated_at = now() WHERE tenant_id = %s AND project_id = %s AND id != %s",
                    (repository["id"], tenant_id, project_id, repository["id"]),
                )
    record_activity(tenant_id, current_user["id"], "project_repository_created", f"Added repository {repository['repo']} to {project['key']}", project_id=project_id, metadata={"repository_id": str(repository["id"]), "repo": repository["repo"]})
    await event_bus.publish(str(tenant_id), "project_repository_created", {"repository": row_to_json(repository), "project_id": project_id})
    return {"repository": row_to_json(repository)}


@router.patch("/{project_id}/repositories/{repository_id}")
async def update_project_repository(project_id: str, repository_id: str, payload: ProjectRepositoryUpdate, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    project = ensure_project(project_id, tenant_id)
    ensure_project_permissions(project, current_user)
    repository = ensure_project_repository(repository_id, tenant_id, project_id)
    default_branch = payload.default_branch.strip() if payload.default_branch is not None else repository["default_branch"]
    branch_prefix = payload.branch_prefix.strip() if payload.branch_prefix is not None else repository["branch_prefix"]
    status = payload.status or repository["status"]
    with get_conn() as conn:
        with conn.cursor() as cur:
            if payload.is_default:
                cur.execute("UPDATE project_repositories SET is_default = false, updated_at = now() WHERE tenant_id = %s AND project_id = %s", (tenant_id, project_id))
            cur.execute(
                """
                UPDATE project_repositories
                SET default_branch = %s,
                    branch_prefix = %s,
                    status = %s,
                    is_default = CASE WHEN %s IS NULL THEN is_default ELSE %s END,
                    updated_at = now()
                WHERE id = %s AND tenant_id = %s
                RETURNING *
                """,
                (default_branch, branch_prefix, status, payload.is_default, payload.is_default if payload.is_default is not None else repository["is_default"], repository_id, tenant_id),
            )
            updated = cur.fetchone()
            if payload.is_default:
                cur.execute(
                    "UPDATE project_repositories SET is_default = (id = %s), updated_at = now() WHERE tenant_id = %s AND project_id = %s AND id != %s",
                    (repository_id, tenant_id, project_id, repository_id),
                )
    record_activity(tenant_id, current_user["id"], "project_repository_updated", f"Updated repository {updated['repo']} for {project['key']}", project_id=project_id, metadata={"repository_id": str(repository_id), "status": status})
    await event_bus.publish(str(tenant_id), "project_repository_updated", {"repository": row_to_json(updated), "project_id": project_id})
    return {"repository": row_to_json(updated)}


@router.delete("/{project_id}/repositories/{repository_id}")
async def disable_project_repository(project_id: str, repository_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    project = ensure_project(project_id, tenant_id)
    ensure_project_permissions(project, current_user)
    repository = ensure_project_repository(repository_id, tenant_id, project_id)
    updated = execute(
        """
        UPDATE project_repositories
        SET status = 'DISABLED',
            is_default = false,
            updated_at = now()
        WHERE id = %s AND tenant_id = %s
        RETURNING *
        """,
        (repository_id, tenant_id),
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Repository not found")
    record_activity(tenant_id, current_user["id"], "project_repository_disabled", f"Disabled repository {repository['repo']} for {project['key']}", project_id=project_id, metadata={"repository_id": str(repository_id)})
    await event_bus.publish(str(tenant_id), "project_repository_disabled", {"repository_id": repository_id, "project_id": project_id})
    return {"ok": True}


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
