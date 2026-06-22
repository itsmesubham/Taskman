from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..database import fetch_all, fetch_one, get_conn
from ..security import create_token, get_current_user
from ..utils import row_to_json, rows_to_json

router = APIRouter(prefix="/api/users", tags=["users"])


class ActiveTenantRequest(BaseModel):
    tenant_id: str


def _memberships_for_user(user_id: str):
    rows = fetch_all(
        """
        SELECT tm.tenant_id, tm.role, tm.status, tm.joined_at,
               t.name AS tenant_name, t.slug AS tenant_slug, t.invite_code, t.invite_enabled
        FROM tenant_members tm
        JOIN tenants t ON t.id = tm.tenant_id
        WHERE tm.user_id = %s
        ORDER BY tm.joined_at ASC
        """,
        (user_id,),
    )
    return rows_to_json(rows)


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    memberships = _memberships_for_user(str(current_user["id"]))
    active_membership = None
    active_tenant_id = current_user.get("active_tenant_id")
    if memberships:
        active_membership = next((membership for membership in memberships if membership.get("tenant_id") == active_tenant_id), None) or memberships[0]
    return {
        "user": row_to_json({
            "id": current_user["id"],
            "name": current_user["name"],
            "email": current_user["email"],
            "active_tenant_id": current_user.get("active_tenant_id"),
            "role": active_membership.get("role") if active_membership else current_user.get("role"),
            "tenant_name": active_membership.get("tenant_name") if active_membership else current_user.get("tenant_name"),
            "tenant_slug": active_membership.get("tenant_slug") if active_membership else current_user.get("tenant_slug"),
        }),
        "memberships": memberships,
    }


@router.patch("/me/active-tenant")
def set_active_tenant(payload: ActiveTenantRequest, current_user: dict = Depends(get_current_user)):
    membership = fetch_one(
        """
        SELECT tm.role, t.id, t.name, t.slug
        FROM tenant_members tm
        JOIN tenants t ON t.id = tm.tenant_id
        WHERE tm.user_id = %s AND tm.tenant_id = %s
        """,
        (current_user["id"], payload.tenant_id),
    )
    if not membership:
        raise HTTPException(status_code=404, detail="Workspace membership not found")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET active_tenant_id = %s, updated_at = now() WHERE id = %s RETURNING active_tenant_id",
                (payload.tenant_id, current_user["id"]),
            )
            updated = cur.fetchone()
    return {
        "active_tenant_id": updated["active_tenant_id"],
        "access_token": create_token(str(current_user["id"]), payload.tenant_id, membership["role"]),
        "tenant": row_to_json({"id": membership["id"], "name": membership["name"], "slug": membership["slug"]}),
        "membership": row_to_json({
            "tenant_id": payload.tenant_id,
            "role": membership["role"],
        }),
        "memberships": _memberships_for_user(str(current_user["id"]))
    }
