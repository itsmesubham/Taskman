import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from ..database import fetch_one, get_conn
from ..security import create_token, get_current_user, hash_password, normalize_email, verify_password
from ..services.memberships import active_membership_for_user, memberships_for_user
from ..utils import row_to_json, rows_to_json

router = APIRouter(prefix="/api/auth", tags=["auth"])
AUTH_RATE_LIMITS: dict[str, deque[float]] = defaultdict(deque)
AUTH_RATE_WINDOW_SECONDS = 60
AUTH_LOGIN_LIMIT = 10
AUTH_SIGNUP_LIMIT = 5


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


def _client_ip(request: Request | None) -> str:
    if request is None:
        return "test"
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"


def _apply_auth_rate_limit(request: Request | None, action: str, limit: int):
    if request is None:
        return
    now = time.time()
    bucket = AUTH_RATE_LIMITS[f"{action}:{_client_ip(request)}"]
    while bucket and now - bucket[0] > AUTH_RATE_WINDOW_SECONDS:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many auth attempts. Please try again later.")
    bucket.append(now)


@router.post("/signup")
def signup(payload: SignupRequest, request: Request = None):
    _apply_auth_rate_limit(request, "signup", AUTH_SIGNUP_LIMIT)
    email = normalize_email(payload.email)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, name, email, password_hash, active_tenant_id FROM users WHERE email = %s", (email,))
            user = cur.fetchone()
            if user:
                if not verify_password(payload.password, user["password_hash"]):
                    raise HTTPException(status_code=409, detail="Unable to create account")
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
def login(payload: LoginRequest, request: Request = None):
    _apply_auth_rate_limit(request, "login", AUTH_LOGIN_LIMIT)
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
