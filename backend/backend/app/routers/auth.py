from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from ..database import fetch_one, get_conn
from ..security import create_token, get_current_user, hash_password, normalize_email, verify_password
from ..services.memberships import active_membership_for_user, memberships_for_user
from ..utils import row_to_json, rows_to_json

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


def _user_payload(user: dict, memberships: list[dict] | None = None):
    memberships = memberships or []
    active_membership = active_membership_for_user(str(user["id"]), user.get("active_tenant_id"), memberships) if memberships else None
    return row_to_json({
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "active_tenant_id": user.get("active_tenant_id"),
        "role": active_membership.get("role") if active_membership else user.get("role"),
        "tenant_name": active_membership.get("tenant_name") if active_membership else user.get("tenant_name"),
        "tenant_slug": active_membership.get("tenant_slug") if active_membership else user.get("tenant_slug"),
    })


@router.post("/signup")
def signup(payload: SignupRequest):
    email = normalize_email(payload.email)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, email, password_hash, active_tenant_id FROM users WHERE email = %s", (email,))
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

    memberships = rows_to_json(memberships_for_user(str(user["id"])))
    return {
        "access_token": create_token(str(user["id"])),
        "token_type": "bearer",
        "user": _user_payload(user, memberships),
        "memberships": memberships,
    }


@router.post("/login")
def login(payload: LoginRequest):
    email = normalize_email(payload.email)
    row = fetch_one(
        "SELECT id, name, email, password_hash, active_tenant_id FROM users WHERE email = %s",
        (email,),
    )
    if not row or not verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    memberships = rows_to_json(memberships_for_user(str(row["id"])))
    return {
        "access_token": create_token(str(row["id"])),
        "token_type": "bearer",
        "user": _user_payload(row, memberships),
        "memberships": memberships,
    }


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    memberships = rows_to_json(memberships_for_user(str(current_user["id"])))
    return {
        "user": _user_payload(current_user, memberships),
        "memberships": memberships,
    }
