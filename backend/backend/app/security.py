from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from typing import Any
import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from .config import get_settings
from .database import fetch_all, fetch_one
from .services.memberships import memberships_for_user

bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def create_token(
    user_id: str,
    tenant_id: str | None = None,
    role: str | None = None,
    *,
    expires_minutes: int | None = None,
    scope: str | None = None,
) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expiry_minutes = expires_minutes if expires_minutes is not None else settings.access_token_expire_minutes
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expiry_minutes)).timestamp()),
    }
    if tenant_id:
        payload["tenant_id"] = tenant_id
    if role:
        payload["role"] = role
    if scope:
        payload["scope"] = scope
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_token(token: str, *, allow_events_scope: bool = False) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, get_settings().jwt_secret, algorithms=["HS256"])
        if payload.get("scope") == "events" and not allow_events_scope:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def _load_user_context(user_id: str, tenant_id: str | None):
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

    memberships = memberships_for_user(user_id)
    if len(memberships) == 1:
        membership = memberships[0]
        return {
            **active_row,
            "tenant_id": membership["tenant_id"],
            "role": membership["role"],
            "tenant_name": membership["tenant_name"],
            "tenant_slug": membership["tenant_slug"],
        }

    return {
        **active_row,
        "tenant_id": None,
        "role": None,
        "tenant_name": None,
        "tenant_slug": None,
    }


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
    return _load_user_context(str(user_id), str(tenant_id) if tenant_id else None)


def create_event_stream_token(user_id: str, tenant_id: str, role: str | None = None) -> str:
    settings = get_settings()
    return create_token(
        user_id,
        tenant_id,
        role,
        expires_minutes=settings.event_stream_token_expire_minutes,
        scope="events",
    )


def get_current_stream_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict[str, Any]:
    token = None
    if credentials and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    if not token:
        token = request.query_params.get("ticket") or request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing auth token")

    payload = decode_token(token, allow_events_scope=True)
    user_id = payload.get("sub")
    tenant_id = payload.get("tenant_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    return _load_user_context(str(user_id), str(tenant_id) if tenant_id else None)


def require_role(*roles: str):
    allowed = set(roles)

    def dependency(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        if current_user["role"] not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return dependency


def normalize_email(email: str) -> str:
    return email.strip().lower()
