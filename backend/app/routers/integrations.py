from __future__ import annotations

from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from ..config import get_settings
from ..services.github import (
    build_github_install_url,
    build_github_manage_url,
    consume_install_state,
    disconnect_github_installation,
    github_status_payload,
    register_install_state,
    sync_installation_repositories,
    verify_installation,
)
from ..security import get_current_user

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


def resolve_tenant_id(current_user: dict) -> str:
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Workspace not selected")
    return str(tenant_id)


def require_manage_permissions(current_user: dict):
    role = str(current_user.get("role") or "").upper()
    if role not in {"OWNER", "ADMIN"}:
        raise HTTPException(status_code=403, detail="You need workspace admin permission to connect GitHub.")


def settings_redirect(*, github: str | None = None, message: str | None = None):
    params = {"tab": "github" if github else "integrations"}
    if github:
        params["github"] = github
    if message:
        params["message"] = message
    url = f"{get_settings().public_app_url.rstrip('/')}/settings?{urlencode(params)}"
    return RedirectResponse(url=url, status_code=303)


@router.get("/github/status")
def github_status(current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    payload = github_status_payload(tenant_id)
    payload["can_manage"] = str(current_user.get("role") or "").upper() in {"OWNER", "ADMIN"}
    return payload


@router.get("/github/install-url")
def github_install_url(current_user: dict = Depends(get_current_user)):
    require_manage_permissions(current_user)
    tenant_id = resolve_tenant_id(current_user)
    state = register_install_state(tenant_id, str(current_user["id"]))
    return {"install_url": build_github_install_url(state)}


@router.post("/github/sync")
def github_sync(current_user: dict = Depends(get_current_user)):
    require_manage_permissions(current_user)
    tenant_id = resolve_tenant_id(current_user)
    installation = github_status_payload(tenant_id)["installation"]
    if not installation:
        raise HTTPException(status_code=404, detail="GitHub is not connected")
    result = sync_installation_repositories(
        tenant_id,
        int(installation["installation_id"]),
        created_by=str(current_user["id"]),
        updated_by=str(current_user["id"]),
    )
    return result


@router.post("/github/disconnect")
def github_disconnect(current_user: dict = Depends(get_current_user)):
    require_manage_permissions(current_user)
    tenant_id = resolve_tenant_id(current_user)
    return disconnect_github_installation(tenant_id)


@router.get("/github/setup")
def github_setup(request: Request):
    installation_id = request.query_params.get("installation_id")
    setup_action = request.query_params.get("setup_action")
    state = request.query_params.get("state")

    state_payload = consume_install_state(state)
    if not state_payload:
        return settings_redirect(github="error", message="GitHub connection failed. Try again.")
    tenant_id = str(state_payload["tenant_id"])
    user_id = str(state_payload["user_id"])

    if not installation_id:
        return settings_redirect(github="error", message="GitHub connection failed. Try again.")

    try:
        installation = verify_installation(installation_id)
        sync_installation_repositories(
            tenant_id,
            int(installation_id),
            created_by=user_id,
            updated_by=user_id,
        )
    except Exception:
        return settings_redirect(github="error", message="Repository sync failed. Try syncing again.")

    _ = setup_action  # intentionally ignored for the MVP flow
    return settings_redirect(github="connected")


@router.get("/github/callback")
def github_callback(request: Request):
    _ = request.query_params.get("code")
    _ = request.query_params.get("state")
    return settings_redirect(github="callback")


@router.get("/github/manage-url")
def github_manage_url(current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    payload = github_status_payload(tenant_id)
    installation = payload.get("installation") or {}
    return {
        "manage_url": build_github_manage_url(installation.get("installation_id")),
        "connected": payload["connected"],
    }
