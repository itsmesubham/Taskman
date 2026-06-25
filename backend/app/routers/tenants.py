import logging

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from ..database import fetch_all, fetch_one, execute, get_conn
from ..security import _users_has_active_tenant_id, create_token, get_current_user, require_role, normalize_email, set_auth_cookie
from ..services.memberships import memberships_for_user
from ..services.workspace_defaults import ensure_workspace_invite, invite_url_for_tenant
from ..services.activity import record_activity
from ..sse import event_bus
from ..utils import row_to_json, rows_to_json, slugify

router = APIRouter(prefix="/api/tenants", tags=["tenants"])
logger = logging.getLogger(__name__)


class TenantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=80)


class MemberInvite(BaseModel):
    email: EmailStr
    role: str = Field(default="MEMBER", pattern="^(OWNER|ADMIN|MEMBER|VIEWER)$")


def _tenant_memberships(user_id: str):
    return rows_to_json(memberships_for_user(user_id))


def resolve_tenant_id(current_user: dict) -> str:
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Workspace not selected")
    return str(tenant_id)


@router.get("")
def list_tenants(search: str | None = None):
    if search:
        rows = fetch_all(
            "SELECT id, name, slug, created_at FROM tenants WHERE name ILIKE %s OR slug ILIKE %s ORDER BY name LIMIT 50",
            (f"%{search}%", f"%{search}%"),
        )
    else:
        rows = fetch_all("SELECT id, name, slug, created_at FROM tenants ORDER BY created_at DESC LIMIT 50")
    return {"tenants": rows_to_json(rows)}


@router.get("/my")
def my_tenants(current_user: dict = Depends(get_current_user)):
    return {
        "tenants": _tenant_memberships(str(current_user["id"])),
        "active_tenant_id": current_user.get("active_tenant_id"),
    }


@router.post("")
def create_tenant(payload: TenantCreate, current_user: dict = Depends(get_current_user), request: Request = None, response: Response = None):
    base_slug = slugify(payload.slug or payload.name)
    slug = base_slug
    suffix = 1
    while fetch_one("SELECT id FROM tenants WHERE slug = %s", (slug,)):
        suffix += 1
        slug = f"{base_slug}-{suffix}"
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO tenants (name, slug, invite_enabled, invite_created_at) VALUES (%s, %s, true, now()) RETURNING *",
                    (payload.name.strip(), slug),
                )
                tenant = cur.fetchone()
                if not tenant:
                    raise HTTPException(status_code=500, detail="Workspace creation failed")

                cur.execute(
                    """
                    INSERT INTO tenant_members (tenant_id, user_id, role, status)
                    VALUES (%s, %s, 'OWNER', 'ACTIVE')
                    ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status
                    RETURNING *
                    """,
                    (tenant["id"], current_user["id"]),
                )
                membership = cur.fetchone()
                if not membership:
                    raise HTTPException(status_code=500, detail="Workspace membership creation failed")

                if _users_has_active_tenant_id():
                    cur.execute(
                        "UPDATE users SET active_tenant_id = %s, updated_at = now() WHERE id = %s",
                        (tenant["id"], current_user["id"]),
                    )
    except HTTPException:
        raise
    except Exception as exc:
        code = getattr(exc, "sqlstate", None)
        if code == "23505":
            logger.warning("Workspace creation conflict for slug %s", slug)
            raise HTTPException(status_code=409, detail="Workspace already exists")
        logger.exception("Workspace creation failed")
        raise HTTPException(status_code=500, detail="Workspace creation failed") from exc

    tenant = ensure_workspace_invite(str(tenant["id"])) or tenant
    token = create_token(str(current_user["id"]), str(tenant["id"]), "OWNER")
    if response is not None and request is not None:
        set_auth_cookie(response, token, request)
    return {
        "tenant": row_to_json({
            "id": tenant["id"],
            "name": tenant["name"],
            "slug": tenant["slug"],
            "invite_code": tenant.get("invite_code"),
            "invite_enabled": tenant.get("invite_enabled", True),
        }),
        "membership": row_to_json(membership),
        "access_token": token,
        "cookie_auth": True,
        "invite_url": invite_url_for_tenant(tenant),
    }


@router.get("/current")
def current_tenant(current_user: dict = Depends(get_current_user)):
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=404, detail="No active workspace")
    tenant = fetch_one("SELECT id, name, slug, invite_code, invite_enabled, invite_created_at, invite_regenerated_at FROM tenants WHERE id = %s", (tenant_id,))
    return {"tenant": row_to_json(tenant)}


@router.get("/{tenant_id}/members")
def members(tenant_id: str, current_user: dict = Depends(get_current_user)):
    if resolve_tenant_id(current_user) != tenant_id:
        raise HTTPException(status_code=403, detail="Cannot access another tenant")
    rows = fetch_all(
        """
        SELECT u.id, u.name, u.email, tm.role, tm.status, tm.joined_at
        FROM tenant_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.tenant_id = %s
        ORDER BY tm.joined_at ASC
        """,
        (tenant_id,),
    )
    return {"members": rows_to_json(rows)}


@router.get("/{tenant_id}/invite-link")
def get_invite_link(tenant_id: str, current_user: dict = Depends(require_role("OWNER", "ADMIN"))):
    if resolve_tenant_id(current_user) != tenant_id:
        raise HTTPException(status_code=403, detail="Cannot access another tenant")
    tenant = ensure_workspace_invite(tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {
        "tenant": row_to_json(tenant),
        "invite_url": invite_url_for_tenant(tenant),
    }


@router.post("/{tenant_id}/invite-link/regenerate")
def regenerate_invite_link(tenant_id: str, current_user: dict = Depends(require_role("OWNER", "ADMIN"))):
    if resolve_tenant_id(current_user) != tenant_id:
        raise HTTPException(status_code=403, detail="Cannot access another tenant")
    tenant = ensure_workspace_invite(tenant_id, force_new=True)
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {
        "tenant": row_to_json(tenant),
        "invite_url": invite_url_for_tenant(tenant),
    }


@router.post("/{tenant_id}/invite-link/revoke")
def revoke_invite_link(tenant_id: str, current_user: dict = Depends(require_role("OWNER", "ADMIN"))):
    if resolve_tenant_id(current_user) != tenant_id:
        raise HTTPException(status_code=403, detail="Cannot access another tenant")
    tenant = execute(
        "UPDATE tenants SET invite_enabled = false, updated_at = now() WHERE id = %s RETURNING *",
        (tenant_id,),
    )
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {"tenant": row_to_json(tenant), "invite_url": invite_url_for_tenant(tenant)}


@router.post("/{tenant_id}/members")
async def add_member(
    tenant_id: str,
    payload: MemberInvite,
    current_user: dict = Depends(require_role("OWNER", "ADMIN")),
):
    if resolve_tenant_id(current_user) != tenant_id:
        raise HTTPException(status_code=403, detail="Cannot access another tenant")
    user = fetch_one("SELECT id, name, email FROM users WHERE email = %s", (normalize_email(payload.email),))
    if not user:
        raise HTTPException(status_code=404, detail="User must sign up once before being added to a tenant")
    membership = execute(
        """
        INSERT INTO tenant_members (tenant_id, user_id, role, status)
        VALUES (%s, %s, %s, 'ACTIVE')
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status
        RETURNING *
        """,
        (tenant_id, user["id"], payload.role),
    )
    record_activity(tenant_id, current_user["id"], "member_added", f"Added {user['email']} as {payload.role}")
    await event_bus.publish(tenant_id, "member_added", {"user_id": user["id"], "email": user["email"], "role": payload.role})
    return {"member": row_to_json({**user, "role": membership["role"], "joined_at": membership["joined_at"]})}


@router.delete("/{tenant_id}/members/{user_id}")
async def remove_member(
    tenant_id: str,
    user_id: str,
    current_user: dict = Depends(require_role("OWNER", "ADMIN")),
):
    if resolve_tenant_id(current_user) != tenant_id:
        raise HTTPException(status_code=403, detail="Cannot access another tenant")
    if current_user["id"] == user_id:
        raise HTTPException(status_code=400, detail="Use leave workspace instead")
    target = fetch_one(
        "SELECT tm.role, u.name, u.email FROM tenant_members tm JOIN users u ON u.id = tm.user_id WHERE tm.tenant_id = %s AND tm.user_id = %s",
        (tenant_id, user_id),
    )
    if not target:
        raise HTTPException(status_code=404, detail="Workspace member not found")
    target_role = str(target["role"]).upper()
    current_role = str(current_user.get("role") or "").upper()
    if target_role == "OWNER" and current_role != "OWNER":
        raise HTTPException(status_code=403, detail="Only an owner can remove another owner")
    removed = execute(
        "DELETE FROM tenant_members WHERE tenant_id = %s AND user_id = %s RETURNING *",
        (tenant_id, user_id),
    )
    if not removed:
        raise HTTPException(status_code=404, detail="Workspace member not found")
    execute(
        """
        UPDATE users
        SET active_tenant_id = NULL, updated_at = now()
        WHERE id = %s AND active_tenant_id = %s
        """,
        (user_id, tenant_id),
    )
    record_activity(tenant_id, current_user["id"], "member_removed", f"Removed {target['email']}")
    await event_bus.publish(tenant_id, "member_removed", {"user_id": user_id, "email": target["email"]})
    return {"ok": True}
