from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from ..database import fetch_one, fetch_all, execute, get_conn
from ..security import create_token, get_current_user, hash_password, normalize_email, verify_password
from ..utils import row_to_json, rows_to_json, slugify

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    tenant_id: str | None = None
    tenant_name: str | None = Field(default=None, max_length=120)
    tenant_slug: str | None = Field(default=None, max_length=80)


class LoginRequest(BaseModel):
    tenant_id: str
    email: EmailStr
    password: str


@router.post("/signup")
def signup(payload: SignupRequest):
    email = normalize_email(payload.email)
    if not payload.tenant_id and not payload.tenant_name:
        raise HTTPException(status_code=400, detail="tenant_id or tenant_name is required")

    with get_conn() as conn:
        with conn.cursor() as cur:
            tenant = None
            created_tenant = False
            if payload.tenant_id:
                cur.execute("SELECT * FROM tenants WHERE id = %s", (payload.tenant_id,))
                tenant = cur.fetchone()
                if not tenant:
                    raise HTTPException(status_code=404, detail="Tenant not found")
            else:
                base_slug = slugify(payload.tenant_slug or payload.tenant_name or "tenant")
                slug = base_slug
                suffix = 1
                while True:
                    cur.execute("SELECT id FROM tenants WHERE slug = %s", (slug,))
                    if not cur.fetchone():
                        break
                    suffix += 1
                    slug = f"{base_slug}-{suffix}"
                cur.execute(
                    "INSERT INTO tenants (name, slug) VALUES (%s, %s) RETURNING *",
                    (payload.tenant_name, slug),
                )
                tenant = cur.fetchone()
                created_tenant = True

            cur.execute("SELECT * FROM users WHERE email = %s", (email,))
            user = cur.fetchone()
            if user:
                if not verify_password(payload.password, user["password_hash"]):
                    raise HTTPException(status_code=409, detail="Email already exists with a different password")
            else:
                cur.execute(
                    "INSERT INTO users (name, email, password_hash) VALUES (%s, %s, %s) RETURNING *",
                    (payload.name.strip(), email, hash_password(payload.password)),
                )
                user = cur.fetchone()

            cur.execute(
                "SELECT COUNT(*) AS count FROM tenant_members WHERE tenant_id = %s",
                (tenant["id"],),
            )
            member_count = cur.fetchone()["count"]
            role = "OWNER" if created_tenant or member_count == 0 else "MEMBER"

            cur.execute(
                "SELECT * FROM tenant_members WHERE tenant_id = %s AND user_id = %s",
                (tenant["id"], user["id"]),
            )
            membership = cur.fetchone()
            if not membership:
                cur.execute(
                    "INSERT INTO tenant_members (tenant_id, user_id, role) VALUES (%s, %s, %s) RETURNING *",
                    (tenant["id"], user["id"], role),
                )
                membership = cur.fetchone()

    token = create_token(str(user["id"]), str(tenant["id"]), membership["role"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": row_to_json({"id": user["id"], "name": user["name"], "email": user["email"], "role": membership["role"]}),
        "tenant": row_to_json(tenant),
    }


@router.post("/login")
def login(payload: LoginRequest):
    email = normalize_email(payload.email)
    row = fetch_one(
        """
        SELECT u.*, tm.role, t.id AS tenant_id, t.name AS tenant_name, t.slug AS tenant_slug
        FROM users u
        JOIN tenant_members tm ON tm.user_id = u.id
        JOIN tenants t ON t.id = tm.tenant_id
        WHERE u.email = %s AND tm.tenant_id = %s
        """,
        (email, payload.tenant_id),
    )
    if not row or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_token(str(row["id"]), str(row["tenant_id"]), row["role"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": row_to_json({"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}),
        "tenant": row_to_json({"id": row["tenant_id"], "name": row["tenant_name"], "slug": row["tenant_slug"]}),
    }


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    return {"user": row_to_json(current_user)}
