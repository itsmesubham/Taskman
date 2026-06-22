from fastapi import APIRouter, Depends, HTTPException, status
from ..database import fetch_one, execute, get_conn
from ..security import create_token, get_current_user
from ..services.memberships import memberships_for_user
from ..utils import row_to_json, rows_to_json

router = APIRouter(prefix="/api/invites", tags=["invites"])


def _invite_payload(tenant):
    return {
        "tenant": row_to_json({
            "id": tenant["id"],
            "name": tenant["name"],
            "slug": tenant["slug"],
            "invite_code": tenant.get("invite_code"),
            "invite_enabled": tenant.get("invite_enabled", True),
        }),
        "workspace_name": tenant["name"],
        "workspace_slug": tenant["slug"],
        "invite_code": tenant.get("invite_code"),
        "invite_enabled": tenant.get("invite_enabled", True),
        "role": "MEMBER",
    }


@router.get("/{invite_code}")
def get_invite(invite_code: str):
    tenant = fetch_one(
        "SELECT id, name, slug, invite_code, invite_enabled FROM tenants WHERE invite_code = %s",
        (invite_code,),
    )
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite link not found")
    if not tenant.get("invite_enabled", True):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invite link is disabled")
    return _invite_payload(tenant)


@router.post("/{invite_code}/accept")
def accept_invite(invite_code: str, current_user: dict = Depends(get_current_user)):
    tenant = fetch_one(
        "SELECT id, name, slug, invite_code, invite_enabled FROM tenants WHERE invite_code = %s",
        (invite_code,),
    )
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite link not found")
    if not tenant.get("invite_enabled", True):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invite link is disabled")

    existing_membership = fetch_one(
        "SELECT tenant_id, user_id, role, status FROM tenant_members WHERE tenant_id = %s AND user_id = %s",
        (tenant["id"], current_user["id"]),
    )
    membership = existing_membership
    if not membership:
        membership = execute(
            """
            INSERT INTO tenant_members (tenant_id, user_id, role, status)
            VALUES (%s, %s, 'MEMBER', 'ACTIVE')
            RETURNING *
            """,
            (tenant["id"], current_user["id"]),
        )

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET active_tenant_id = %s, updated_at = now() WHERE id = %s RETURNING active_tenant_id",
                (tenant["id"], current_user["id"]),
            )
            updated = cur.fetchone()

    return {
        "already_member": bool(existing_membership),
        "active_tenant_id": updated["active_tenant_id"],
        "access_token": create_token(str(current_user["id"]), str(tenant["id"]), membership["role"]),
        "tenant": row_to_json({
            "id": tenant["id"],
            "name": tenant["name"],
            "slug": tenant["slug"],
            "invite_code": tenant.get("invite_code"),
        }),
        "membership": row_to_json(membership),
        "memberships": rows_to_json(memberships_for_user(str(current_user["id"])))
    }
