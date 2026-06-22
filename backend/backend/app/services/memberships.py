from __future__ import annotations

from ..database import fetch_all


def memberships_for_user(user_id: str):
    return fetch_all(
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


def active_membership_for_user(user_id: str, active_tenant_id: str | None = None, memberships: list[dict] | None = None):
    rows = memberships if memberships is not None else memberships_for_user(user_id)
    if not rows:
        return None
    if active_tenant_id:
        match = next((membership for membership in rows if membership.get("tenant_id") == active_tenant_id), None)
        if match:
            return match
    return rows[0]
