from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from ..database import fetch_all, fetch_one, execute
from ..security import get_current_user, require_role, normalize_email
from ..utils import row_to_json, rows_to_json, slugify
from ..services.activity import record_activity
from ..sse import event_bus

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


class TenantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=80)


class MemberInvite(BaseModel):
    email: EmailStr
    role: str = Field(default="MEMBER", pattern="^(OWNER|ADMIN|MEMBER|VIEWER)$")


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


@router.post("")
def create_tenant(payload: TenantCreate):
    base_slug = slugify(payload.slug or payload.name)
    slug = base_slug
    suffix = 1
    while fetch_one("SELECT id FROM tenants WHERE slug = %s", (slug,)):
        suffix += 1
        slug = f"{base_slug}-{suffix}"
    tenant = execute(
        "INSERT INTO tenants (name, slug) VALUES (%s, %s) RETURNING *",
        (payload.name.strip(), slug),
    )
    return {"tenant": row_to_json(tenant)}


@router.get("/current")
def current_tenant(current_user: dict = Depends(get_current_user)):
    tenant = fetch_one("SELECT * FROM tenants WHERE id = %s", (current_user["tenant_id"],))
    return {"tenant": row_to_json(tenant)}


@router.get("/{tenant_id}/members")
def members(tenant_id: str, current_user: dict = Depends(get_current_user)):
    if str(current_user["tenant_id"]) != tenant_id:
        raise HTTPException(status_code=403, detail="Cannot access another tenant")
    rows = fetch_all(
        """
        SELECT u.id, u.name, u.email, tm.role, tm.joined_at
        FROM tenant_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.tenant_id = %s
        ORDER BY tm.joined_at ASC
        """,
        (tenant_id,),
    )
    return {"members": rows_to_json(rows)}


@router.post("/{tenant_id}/members")
async def add_member(
    tenant_id: str,
    payload: MemberInvite,
    current_user: dict = Depends(require_role("OWNER", "ADMIN")),
):
    if str(current_user["tenant_id"]) != tenant_id:
        raise HTTPException(status_code=403, detail="Cannot access another tenant")
    user = fetch_one("SELECT id, name, email FROM users WHERE email = %s", (normalize_email(payload.email),))
    if not user:
        raise HTTPException(status_code=404, detail="User must sign up once before being added to a tenant")
    membership = execute(
        """
        INSERT INTO tenant_members (tenant_id, user_id, role)
        VALUES (%s, %s, %s)
        ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role
        RETURNING *
        """,
        (tenant_id, user["id"], payload.role),
    )
    record_activity(tenant_id, current_user["id"], "member_added", f"Added {user['email']} as {payload.role}")
    await event_bus.publish(tenant_id, "member_added", {"user_id": user["id"], "email": user["email"], "role": payload.role})
    return {"member": row_to_json({**user, "role": membership["role"], "joined_at": membership["joined_at"]})}
