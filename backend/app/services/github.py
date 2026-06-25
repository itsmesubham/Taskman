from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request as UrlRequest, urlopen

import jwt
from fastapi import HTTPException, status

try:
    from cryptography.hazmat.primitives import serialization
except Exception:  # pragma: no cover - optional dependency in some deployments
    serialization = None

from ..config import get_settings
from ..database import execute, fetch_all, fetch_one, get_conn
from ..utils import row_to_json, rows_to_json

GITHUB_API_BASE = "https://api.github.com"
GITHUB_APP_BASE = "https://github.com/apps"
GITHUB_SETTINGS_BASE = "https://github.com/settings/installations"


def _settings():
    return get_settings()


def _github_error(message: str, code: int = 502) -> HTTPException:
    return HTTPException(status_code=code, detail=message)


def _require_cryptography() -> None:
    if serialization is None:
        raise _github_error("GitHub integration requires the cryptography package", code=503)


def _json_dumps(payload: Any) -> bytes:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _json_loads(body: bytes) -> Any:
    if not body:
        return None
    return json.loads(body.decode("utf-8"))


def _github_request(
    method: str,
    path: str,
    *,
    token: str | None = None,
    payload: dict | None = None,
    extra_headers: dict[str, str] | None = None,
) -> tuple[Any, dict[str, str], int]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if extra_headers:
        headers.update(extra_headers)
    data = _json_dumps(payload) if payload is not None else None
    if data is not None:
        headers["Content-Type"] = "application/json"
    request = UrlRequest(f"{GITHUB_API_BASE}{path}", data=data, method=method.upper())
    for key, value in headers.items():
        request.add_header(key, value)
    try:
        with urlopen(request, timeout=20) as response:
            body = response.read()
            payload_json = _json_loads(body)
            return payload_json, dict(response.headers.items()), response.status
    except HTTPError as exc:
        body = exc.read() if hasattr(exc, "read") else b""
        message = None
        try:
            message = (_json_loads(body) or {}).get("message")
        except Exception:
            message = None
        code = 404 if exc.code == 404 else 502
        raise _github_error(message or f"GitHub request failed ({exc.code})", code=code) from exc
    except URLError as exc:
        raise _github_error("GitHub connection failed", code=502) from exc


def build_github_app_jwt() -> str:
    settings = _settings()
    if not settings.github_app_id or not settings.github_private_key_pem:
        raise _github_error("GitHub app is not configured", code=500)
    _require_cryptography()
    now = int(time.time())
    payload = {
        "iat": now - 60,
        "exp": now + 9 * 60,
        "iss": settings.github_app_id,
    }
    private_key = serialization.load_pem_private_key(settings.github_private_key_pem.encode("utf-8"), password=None)
    return jwt.encode(payload, private_key, algorithm="RS256")


def build_github_install_url(state: str) -> str:
    settings = _settings()
    slug = settings.github_app_slug.strip() or "taskman-ai"
    return f"{GITHUB_APP_BASE}/{quote(slug, safe='')}/installations/new?state={quote(state, safe='')}"


def build_github_manage_url(installation_id: int | str | None = None) -> str:
    if installation_id:
        return f"{GITHUB_SETTINGS_BASE}/{installation_id}"
    settings = _settings()
    slug = settings.github_app_slug.strip() or "taskman-ai"
    return f"{GITHUB_APP_BASE}/{quote(slug, safe='')}/installations/new"


def _app_headers(extra_headers: dict[str, str] | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {build_github_app_jwt()}"}
    if extra_headers:
        headers.update(extra_headers)
    return headers


def _installation_access_token_response(installation_id: int | str) -> dict[str, Any]:
    payload, _, _ = _github_request(
        "POST",
        f"/app/installations/{installation_id}/access_tokens",
        token=build_github_app_jwt(),
        payload={},
    )
    if not payload or not payload.get("token"):
        raise _github_error("Unable to create GitHub installation token")
    return payload


def get_installation_access_token(installation_id: int | str) -> str:
    return str(_installation_access_token_response(installation_id)["token"])


def verify_installation(installation_id: int | str) -> dict[str, Any]:
    payload, _, _ = _github_request("GET", f"/app/installations/{installation_id}", token=build_github_app_jwt())
    if not payload:
        raise _github_error("GitHub installation not found", code=404)
    return payload


def list_installation_repositories(installation_id: int | str) -> list[dict[str, Any]]:
    token = get_installation_access_token(installation_id)
    payload, _, _ = _github_request("GET", "/installation/repositories", token=token)
    repositories = payload.get("repositories", []) if isinstance(payload, dict) else []
    return repositories


def fetch_pull_request(owner: str, repo: str, pr_number: int | str, installation_id: int | str) -> dict[str, Any]:
    token = get_installation_access_token(installation_id)
    payload, _, _ = _github_request("GET", f"/repos/{owner}/{repo}/pulls/{pr_number}", token=token)
    return payload or {}


def fetch_pull_request_reviews(owner: str, repo: str, pr_number: int | str, installation_id: int | str) -> list[dict[str, Any]]:
    token = get_installation_access_token(installation_id)
    payload, _, _ = _github_request("GET", f"/repos/{owner}/{repo}/pulls/{pr_number}/reviews", token=token)
    return payload if isinstance(payload, list) else []


def fetch_pull_request_checks(owner: str, repo: str, sha: str, installation_id: int | str) -> dict[str, Any]:
    token = get_installation_access_token(installation_id)
    payload, _, _ = _github_request("GET", f"/repos/{owner}/{repo}/commits/{sha}/check-runs", token=token)
    return payload or {}


def build_install_state(*, tenant_id: str, user_id: str, nonce: str | None = None, created_at: int | None = None) -> str:
    settings = _settings()
    payload = {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "nonce": nonce or secrets.token_urlsafe(16),
        "created_at": created_at or int(datetime.now(timezone.utc).timestamp()),
    }
    encoded = base64.urlsafe_b64encode(_json_dumps(payload)).decode("utf-8").rstrip("=")
    secret = (settings.github_state_secret or settings.jwt_secret).encode("utf-8")
    signature = hmac.new(secret, encoded.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def verify_install_state(state: str | None) -> dict[str, Any] | None:
    if not state:
        return None
    settings = _settings()
    try:
        encoded, signature = state.split(".", 1)
        secret = (settings.github_state_secret or settings.jwt_secret).encode("utf-8")
        expected = hmac.new(secret, encoded.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return None
        payload = _json_loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if not isinstance(payload, dict):
            return None
        if payload.get("tenant_id") and payload.get("user_id") and payload.get("nonce"):
            return payload
    except Exception:
        return None
    return None


def verify_webhook_signature(raw_body: bytes, signature_header: str | None) -> bool:
    secret = _settings().github_webhook_secret.strip()
    if not secret or not signature_header or not signature_header.startswith("sha256="):
        return False
    digest = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, signature_header.removeprefix("sha256="))


def parse_github_pr_url(url: str) -> tuple[str, str, int]:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"https", "http"} or parsed.netloc.lower() != "github.com":
        raise HTTPException(status_code=400, detail="PR URL must point to github.com")
    match = parsed.path.strip("/").split("/")
    if len(match) < 4 or match[2] != "pull":
        raise HTTPException(status_code=400, detail="PR URL must reference a pull request")
    owner, repo, _, number = match[:4]
    if not number.isdigit():
        raise HTTPException(status_code=400, detail="PR number is invalid")
    return owner, repo, int(number)


def register_install_state(tenant_id: str, user_id: str) -> str:
    state_token = build_install_state(tenant_id=tenant_id, user_id=user_id)
    payload = verify_install_state(state_token)
    if not payload:
        raise _github_error("Unable to create GitHub state token", code=500)
    execute(
        """
        INSERT INTO github_installation_states (tenant_id, user_id, nonce, state_token)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (tenant_id, user_id, nonce)
        DO UPDATE SET state_token = EXCLUDED.state_token, consumed_at = NULL
        """,
        (tenant_id, user_id, payload["nonce"], state_token),
    )
    return state_token


def consume_install_state(state: str | None):
    payload = verify_install_state(state)
    if not payload:
        return None
    row = fetch_one(
        """
        SELECT id, tenant_id, user_id, nonce, state_token, installation_id, created_at, consumed_at
        FROM github_installation_states
        WHERE tenant_id = %s AND user_id = %s AND nonce = %s AND state_token = %s
        """,
        (payload["tenant_id"], payload["user_id"], payload["nonce"], state),
    )
    if not row:
        return None
    execute(
        """
        UPDATE github_installation_states
        SET consumed_at = now()
        WHERE id = %s
        """,
        (row["id"],),
    )
    return {**payload, "state_row": row_to_json(row)}


def get_github_installation_for_tenant(tenant_id: str):
    return fetch_one(
        """
        SELECT id, tenant_id, installation_id, app_slug, account_login, account_type, status, synced_repository_count, last_synced_at, created_by, updated_by, created_at, updated_at
        FROM github_installations
        WHERE tenant_id = %s
        """,
        (tenant_id,),
    )


def get_github_installation_by_installation_id(installation_id: int | str):
    return fetch_one(
        """
        SELECT id, tenant_id, installation_id, app_slug, account_login, account_type, status, synced_repository_count, last_synced_at, created_by, updated_by, created_at, updated_at
        FROM github_installations
        WHERE installation_id = %s
        """,
        (installation_id,),
    )


def get_github_repositories_for_tenant(tenant_id: str):
    rows = fetch_all(
        """
        SELECT gr.id, gr.tenant_id, gr.installation_id, gr.provider, gr.owner, gr.repo, gr.full_name, gr.visibility, gr.default_branch, gr.status, gr.last_synced_at, gr.created_at, gr.updated_at,
               COALESCE(linked.linked_projects, 0) AS linked_projects
        FROM github_repositories gr
        LEFT JOIN (
            SELECT github_repository_id, COUNT(*)::int AS linked_projects
            FROM project_repositories
            WHERE github_repository_id IS NOT NULL
            GROUP BY github_repository_id
        ) linked ON linked.github_repository_id = gr.id
        WHERE gr.tenant_id = %s
        ORDER BY gr.status DESC, gr.full_name ASC
        """,
        (tenant_id,),
    )
    return rows_to_json(rows)


def get_github_repository_counts_for_tenant(tenant_id: str) -> dict[str, int]:
    rows = fetch_all(
        """
        SELECT gr.id AS github_repository_id, COUNT(pr.id)::int AS project_count
        FROM github_repositories gr
        LEFT JOIN project_repositories pr ON pr.github_repository_id = gr.id AND pr.tenant_id = gr.tenant_id
        WHERE gr.tenant_id = %s
        GROUP BY gr.id
        """,
        (tenant_id,),
    )
    return {str(row["github_repository_id"]): int(row["project_count"]) for row in rows}


def upsert_github_installation(
    *,
    tenant_id: str,
    installation_id: int,
    account_login: str,
    account_type: str,
    created_by: str | None = None,
    updated_by: str | None = None,
):
    row = execute(
        """
        INSERT INTO github_installations (tenant_id, installation_id, account_login, account_type, created_by, updated_by, status, app_slug, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, 'CONNECTED', %s, now())
        ON CONFLICT (tenant_id)
        DO UPDATE SET
            installation_id = EXCLUDED.installation_id,
            account_login = EXCLUDED.account_login,
            account_type = EXCLUDED.account_type,
            updated_by = EXCLUDED.updated_by,
            status = 'CONNECTED',
            app_slug = EXCLUDED.app_slug,
            updated_at = now()
        RETURNING id, tenant_id, installation_id, app_slug, account_login, account_type, status, synced_repository_count, last_synced_at, created_by, updated_by, created_at, updated_at
        """,
        (tenant_id, installation_id, account_login, account_type, created_by, updated_by, _settings().github_app_slug),
    )
    return row_to_json(row) if row else None


def upsert_github_repository(tenant_id: str, installation_id: int, repo_payload: dict[str, Any]):
    owner = repo_payload.get("owner", {}).get("login") or ""
    repo_name = repo_payload.get("name") or ""
    full_name = repo_payload.get("full_name") or f"{owner}/{repo_name}"
    visibility = repo_payload.get("visibility") or ("private" if repo_payload.get("private") else "public")
    default_branch = repo_payload.get("default_branch") or "main"
    github_repository_id = int(repo_payload.get("id"))
    return execute(
        """
        INSERT INTO github_repositories (
            tenant_id, installation_id, github_repository_id, provider, owner, repo, full_name, visibility, default_branch, status, last_synced_at, updated_at
        )
        VALUES (%s, %s, %s, 'github', %s, %s, %s, %s, %s, 'ACTIVE', now(), now())
        ON CONFLICT (tenant_id, github_repository_id)
        DO UPDATE SET
            installation_id = EXCLUDED.installation_id,
            provider = 'github',
            owner = EXCLUDED.owner,
            repo = EXCLUDED.repo,
            full_name = EXCLUDED.full_name,
            visibility = EXCLUDED.visibility,
            default_branch = EXCLUDED.default_branch,
            status = 'ACTIVE',
            last_synced_at = now(),
            updated_at = now()
        RETURNING id, tenant_id, installation_id, github_repository_id, provider, owner, repo, full_name, visibility, default_branch, status, last_synced_at, created_at, updated_at
        """,
        (tenant_id, installation_id, github_repository_id, owner, repo_name, full_name, visibility, default_branch),
    )


def mark_missing_github_repositories_disabled(tenant_id: str, installation_id: int, synced_ids: set[int]):
    if synced_ids:
        execute(
            """
            UPDATE github_repositories
            SET status = 'DISABLED', updated_at = now()
            WHERE tenant_id = %s AND installation_id = %s AND github_repository_id <> ALL(%s)
            """,
            (tenant_id, installation_id, list(synced_ids)),
        )
    else:
        execute(
            """
            UPDATE github_repositories
            SET status = 'DISABLED', updated_at = now()
            WHERE tenant_id = %s AND installation_id = %s
            """,
            (tenant_id, installation_id),
        )


def sync_installation_repositories(tenant_id: str, installation_id: int, *, created_by: str | None = None, updated_by: str | None = None):
    installation = verify_installation(installation_id)
    account = installation.get("account") or {}
    repositories = list_installation_repositories(installation_id)
    if not repositories:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No repositories were selected during installation")

    installation_row = upsert_github_installation(
        tenant_id=tenant_id,
        installation_id=installation_id,
        account_login=str(account.get("login") or ""),
        account_type=str(account.get("type") or ""),
        created_by=created_by,
        updated_by=updated_by,
    )
    synced_ids: set[int] = set()
    repo_rows = []
    for repository in repositories:
        repo_row = upsert_github_repository(tenant_id, installation_id, repository)
        repo_rows.append(row_to_json(repo_row) if repo_row else None)
        if repository.get("id") is not None:
            synced_ids.add(int(repository["id"]))
    mark_missing_github_repositories_disabled(tenant_id, installation_id, synced_ids)
    execute(
        """
        UPDATE github_installations
        SET synced_repository_count = %s,
            last_synced_at = now(),
            updated_at = now()
        WHERE tenant_id = %s
        """,
        (len(repositories), tenant_id),
    )
    installation_row = get_github_installation_for_tenant(tenant_id)
    return {
        "installation": row_to_json(installation_row) if installation_row else None,
        "repositories": get_github_repositories_for_tenant(tenant_id),
    }


def disconnect_github_installation(tenant_id: str):
    installation = get_github_installation_for_tenant(tenant_id)
    if not installation:
        return {"installation": None, "repositories": []}
    execute(
        """
        UPDATE github_installations
        SET status = 'DISCONNECTED',
            updated_at = now()
        WHERE tenant_id = %s
        """,
        (tenant_id,),
    )
    execute(
        """
        UPDATE github_repositories
        SET status = 'DISABLED',
            updated_at = now()
        WHERE tenant_id = %s AND installation_id = %s
        """,
        (tenant_id, installation["installation_id"]),
    )
    return {
        "installation": row_to_json(get_github_installation_for_tenant(tenant_id)),
        "repositories": get_github_repositories_for_tenant(tenant_id),
    }


def github_repository_by_id(tenant_id: str, github_repository_id: str):
    return fetch_one(
        """
        SELECT id, tenant_id, installation_id, github_repository_id, provider, owner, repo, full_name, visibility, default_branch, status, last_synced_at, created_at, updated_at
        FROM github_repositories
        WHERE tenant_id = %s AND id = %s
        """,
        (tenant_id, github_repository_id),
    )


def github_repository_by_full_name(tenant_id: str, full_name: str):
    return fetch_one(
        """
        SELECT id, tenant_id, installation_id, github_repository_id, provider, owner, repo, full_name, visibility, default_branch, status, last_synced_at, created_at, updated_at
        FROM github_repositories
        WHERE tenant_id = %s AND full_name = %s
        """,
        (tenant_id, full_name),
    )


def project_repository_counts(tenant_id: str):
    rows = fetch_all(
        """
        SELECT github_repository_id, COUNT(*)::int AS project_count
        FROM project_repositories
        WHERE github_repository_id IS NOT NULL AND tenant_id = %s
        GROUP BY github_repository_id
        """,
        (tenant_id,),
    )
    return {str(row["github_repository_id"]): int(row["project_count"]) for row in rows}


def github_status_payload(tenant_id: str):
    installation = get_github_installation_for_tenant(tenant_id)
    repositories = get_github_repositories_for_tenant(tenant_id)
    counts = project_repository_counts(tenant_id)
    manage_url = build_github_manage_url(installation["installation_id"]) if installation else build_github_manage_url()
    return {
        "connected": bool(installation and installation.get("status") == "CONNECTED"),
        "installation": row_to_json(installation) if installation else None,
        "repositories": repositories,
        "project_repository_counts": counts,
        "linked_project_repositories_count": sum(counts.values()),
        "manage_url": manage_url,
    }
