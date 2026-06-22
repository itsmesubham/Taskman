from datetime import datetime, timedelta, timezone
from typing import Any
import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from .config import get_settings
from .database import fetch_all, fetch_one

bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, tenant_id: str | None = None, role: str | None = None) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_expire_minutes)).timestamp()),
    }
    if tenant_id:
        payload["tenant_id"] = tenant_id
    if role:
        payload["role"] = role
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict[str, Any]:
    token = None
    if credentials and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    if not token:
        token = request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing auth token")

    payload = decode_token(token)
    user_id = payload.get("sub")
    tenant_id = payload.get("tenant_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    if tenant_id:
        row = fetch_one(
            """
            SELECT u.id, u.name, u.email, u.active_tenant_id, tm.tenant_id, tm.role, t.name AS tenant_name, t.slug AS tenant_slug
            FROM users u
            JOIN tenant_members tm ON tm.user_id = u.id
            JOIN tenants t ON t.id = tm.tenant_id
            WHERE u.id = %s AND tm.tenant_id = %s
            """,
            (user_id, tenant_id),
        )
        if not row:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User is not a tenant member")
        return row

    active_row = fetch_one(
        """
        SELECT u.id, u.name, u.email, u.active_tenant_id, tm.tenant_id, tm.role, t.name AS tenant_name, t.slug AS tenant_slug
        FROM users u
        LEFT JOIN tenant_members tm ON tm.user_id = u.id AND tm.tenant_id = u.active_tenant_id
        LEFT JOIN tenants t ON t.id = tm.tenant_id
        WHERE u.id = %s
        """,
        (user_id,),
    )
    if not active_row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if active_row["tenant_id"]:
        return active_row

    memberships = fetch_all(
        """
        SELECT tm.tenant_id, tm.role, t.name AS tenant_name, t.slug AS tenant_slug
        FROM tenant_members tm
        JOIN tenants t ON t.id = tm.tenant_id
        WHERE tm.user_id = %s AND tm.status = 'ACTIVE'
        ORDER BY tm.created_at ASC
        """,
        (user_id,),
    )
    if len(memberships) == 1:
        membership = memberships[0]
        return {
            **active_row,
            "tenant_id": membership["tenant_id"],
            "role": membership["role"],
            "tenant_name": membership["tenant_name"],
            "tenant_slug": membership["tenant_slug"],
        }

    row = fetch_one(
        """
        SELECT u.id, u.name, u.email, u.active_tenant_id, NULL::uuid AS tenant_id, NULL::text AS role, NULL::text AS tenant_name, NULL::text AS tenant_slug
        FROM users u
        WHERE u.id = %s
        """,
        (user_id,),
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return row


def require_role(*roles: str):
    allowed = set(roles)

    def dependency(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        if current_user["role"] not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return dependency


def normalize_email(email: str) -> str:
    return email.strip().lower()
