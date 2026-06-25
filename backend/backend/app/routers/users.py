from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from ..database import fetch_one, get_conn
from ..security import _users_has_active_tenant_id, create_token, get_current_user, set_auth_cookie
from ..services.memberships import active_membership_for_user, memberships_for_user
from ..utils import row_to_json, rows_to_json

router = APIRouter(prefix="/api/users", tags=["users"])


class ActiveTenantRequest(BaseModel):
    tenant_id: str


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    memberships = rows_to_json(memberships_for_user(str(current_user["id"])))
    active_membership = active_membership_for_user(str(current_user["id"]), current_user.get("active_tenant_id"), memberships) if memberships else None
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
def set_active_tenant(payload: ActiveTenantRequest, current_user: dict = Depends(get_current_user), request: Request = None, response: Response = None):
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
            updated = {"active_tenant_id": payload.tenant_id}
            if _users_has_active_tenant_id():
                cur.execute(
                    "UPDATE users SET active_tenant_id = %s, updated_at = now() WHERE id = %s RETURNING active_tenant_id",
                    (payload.tenant_id, current_user["id"]),
                )
                updated = cur.fetchone() or updated
    token = create_token(str(current_user["id"]), payload.tenant_id, membership["role"])
    if response is not None and request is not None:
        set_auth_cookie(response, token, request)
    return {
        "active_tenant_id": updated["active_tenant_id"],
        "access_token": token,
        "cookie_auth": True,
        "tenant": row_to_json({"id": membership["id"], "name": membership["name"], "slug": membership["slug"]}),
        "membership": row_to_json({
            "tenant_id": payload.tenant_id,
            "role": membership["role"],
        }),
        "memberships": rows_to_json(memberships_for_user(str(current_user["id"])))
    }
