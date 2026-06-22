from __future__ import annotations

from calendar import monthrange
from datetime import date
import secrets

from ..database import fetch_all, fetch_one, get_conn
from ..utils import project_key, row_to_json


def _month_bounds(value: date) -> tuple[date, date]:
    start = value.replace(day=1)
    end = value.replace(day=monthrange(value.year, value.month)[1])
    return start, end


def _next_month_start(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def _month_name(value: date) -> str:
    return value.strftime("%B %Y")


def _generate_invite_code() -> str:
    return secrets.token_urlsafe(8).rstrip("=")


def ensure_workspace_invite(tenant_id: str, force_new: bool = False):
    tenant = fetch_one("SELECT * FROM tenants WHERE id = %s", (tenant_id,))
    if not tenant:
        return None

    invite_code = (tenant.get("invite_code") or "").strip() if tenant else ""
    invite_enabled = bool(tenant.get("invite_enabled", True)) if tenant else True
    if invite_code and invite_enabled and not force_new:
        return tenant
    if invite_code and not invite_enabled and not force_new:
        return tenant

    code = _generate_invite_code()
    while fetch_one("SELECT id FROM tenants WHERE invite_code = %s", (code,)):
        code = _generate_invite_code()

    updates = ["invite_code = %s", "invite_enabled = true"]
    params: list[object] = [code]
    if force_new:
        updates.append("invite_regenerated_at = now()")
    elif not tenant.get("invite_created_at"):
        updates.append("invite_created_at = now()")
    query = f"UPDATE tenants SET {', '.join(updates)}, updated_at = now() WHERE id = %s RETURNING *"
    params.append(tenant_id)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            updated = cur.fetchone()
    return updated


def invite_url_for_tenant(tenant: dict) -> str:
    invite_code = (tenant.get("invite_code") or "").strip()
    if not invite_code and tenant.get("invite_enabled", True):
        tenant = ensure_workspace_invite(str(tenant["id"])) or tenant
        invite_code = (tenant.get("invite_code") or "").strip()
    return f"/invite/{invite_code}" if invite_code else ""


def ensure_default_project(tenant_id: str):
    if not tenant_id:
        return None
    tenant = fetch_one("SELECT * FROM tenants WHERE id = %s", (tenant_id,))
    tenant_name = (tenant["name"] if tenant else "Workspace").strip() or "Workspace"
    default_key = project_key(tenant_name)
    existing = fetch_one(
        "SELECT * FROM projects WHERE tenant_id = %s AND key = %s LIMIT 1",
        (tenant_id, default_key),
    )
    if existing:
        return existing

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO projects (tenant_id, name, key, description, visibility, created_by)
                VALUES (%s, %s, %s, %s, %s, NULL)
                ON CONFLICT (tenant_id, key)
                DO NOTHING
                RETURNING *
                """,
                (
                    tenant_id,
                    tenant_name,
                    default_key,
                    "Auto-created default project for this workspace.",
                    "EVERYONE",
                ),
            )
            project = cur.fetchone()
            if project:
                return project
            cur.execute(
                "SELECT * FROM projects WHERE tenant_id = %s AND key = %s LIMIT 1",
                (tenant_id, default_key),
            )
            project = cur.fetchone()
    return project


def ensure_current_monthly_sprint(tenant_id: str, project_id: str):
    if not tenant_id or not project_id:
        return None
    today = date.today()
    start_date, end_date = _month_bounds(today)
    sprint_name = _month_name(today)

    with get_conn() as conn:
        with conn.cursor() as cur:
            lock_key = f"{tenant_id}:{project_id}:{start_date.isoformat()}:{end_date.isoformat()}"
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s)::bigint)", (lock_key,))
            cur.execute(
                """
                UPDATE sprints
                SET status = 'COMPLETED', updated_at = now()
                WHERE tenant_id = %s AND project_id = %s AND end_date < %s AND status <> 'COMPLETED'
                """,
                (tenant_id, project_id, today),
            )
            cur.execute(
                """
                SELECT * FROM sprints
                WHERE tenant_id = %s AND project_id = %s AND start_date = %s AND end_date = %s
                ORDER BY created_at ASC
                LIMIT 1
                """,
                (tenant_id, project_id, start_date, end_date),
            )
            sprint = cur.fetchone()
            if sprint:
                if sprint["status"] != "ACTIVE":
                    cur.execute(
                        "UPDATE sprints SET status = 'ACTIVE', updated_at = now() WHERE id = %s AND tenant_id = %s RETURNING *",
                        (sprint["id"], tenant_id),
                    )
                    sprint = cur.fetchone()
                return sprint

            cur.execute(
                """
                INSERT INTO sprints (tenant_id, project_id, name, goal, status, start_date, end_date, created_by)
                VALUES (%s, %s, %s, %s, 'ACTIVE', %s, %s, NULL)
                RETURNING *
                """,
                (
                    tenant_id,
                    project_id,
                    sprint_name,
                    "Auto-created monthly sprint for board-first task tracking.",
                    start_date,
                end_date,
                ),
            )
            sprint = cur.fetchone()
            if sprint:
                return sprint
            cur.execute(
                """
                SELECT * FROM sprints
                WHERE tenant_id = %s AND project_id = %s AND start_date = %s AND end_date = %s
                ORDER BY created_at ASC
                LIMIT 1
                """,
                (tenant_id, project_id, start_date, end_date),
            )
            sprint = cur.fetchone()
    return sprint


def ensure_workspace_board_defaults(tenant_id: str):
    if not tenant_id:
        return {"project": None, "sprint": None}
    project = ensure_default_project(tenant_id)
    sprint = ensure_current_monthly_sprint(tenant_id, project["id"]) if project else None
    return {"project": project, "sprint": sprint}


def get_workspace_sprint_schedule(tenant_id: str, project_id: str | None = None):
    project = None
    if project_id:
        project = fetch_one("SELECT * FROM projects WHERE id = %s AND tenant_id = %s", (project_id, tenant_id))
    if not project:
        project = ensure_default_project(tenant_id)

    current_sprint = ensure_current_monthly_sprint(tenant_id, project["id"]) if project else None
    today = date.today()
    next_month = _next_month_start(today)
    next_start, _ = _month_bounds(next_month)
    next_name = _month_name(next_month)

    last_created_sprint = fetch_one(
        """
        SELECT * FROM sprints
        WHERE tenant_id = %s AND project_id = %s
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (tenant_id, project["id"]),
    )
    upcoming = fetch_one(
        """
        SELECT * FROM sprints
        WHERE tenant_id = %s AND project_id = %s AND start_date > %s
        ORDER BY start_date ASC
        LIMIT 1
        """,
        (tenant_id, project["id"], today),
    )

    return {
        "autoSprintEnabled": True,
        "frequency": "Monthly",
        "currentSprint": row_to_json(current_sprint),
        "nextSprintName": upcoming["name"] if upcoming else next_name,
        "nextCreationDate": (upcoming["start_date"].isoformat() if upcoming else next_start.isoformat()),
        "lastCreatedSprint": row_to_json(last_created_sprint),
        "defaultProject": row_to_json(project),
    }
