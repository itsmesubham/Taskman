import asyncio
import sys
import types
import unittest
from unittest.mock import patch
from fastapi import HTTPException

if "psycopg" not in sys.modules:
    psycopg = types.ModuleType("psycopg")
    psycopg_rows = types.ModuleType("psycopg.rows")
    psycopg_rows.dict_row = object()
    psycopg.rows = psycopg_rows
    sys.modules["psycopg"] = psycopg
    sys.modules["psycopg.rows"] = psycopg_rows

if "psycopg_pool" not in sys.modules:
    psycopg_pool = types.ModuleType("psycopg_pool")

    class ConnectionPool:  # pragma: no cover - stub for unit tests
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

        def connection(self):
            raise AssertionError("not used")

        def close(self):
            return None

    psycopg_pool.ConnectionPool = ConnectionPool
    sys.modules["psycopg_pool"] = psycopg_pool

from app.routers.ai import acceptance_criteria, breakdown, sprint_insights, sprint_plan
from app.routers.auth import LoginRequest, SignupRequest, login, me as auth_me, signup
from app.routers.invites import accept_invite, get_invite
from app.routers.tenants import TenantCreate, create_tenant, current_tenant, get_invite_link, members, my_tenants, regenerate_invite_link, remove_member, resolve_tenant_id, revoke_invite_link
from app.routers.users import ActiveTenantRequest, me as user_me, set_active_tenant


class FakeCursor:
    def __init__(self, executor):
        self.executor = executor
        self.executed = []
        self.fetchone_result = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=()):
        self.executed.append((query, params))
        self.fetchone_result = self.executor(query, params)

    def fetchone(self):
        return self.fetchone_result


class FakeConn:
    def __init__(self, executor):
        self.cursor_obj = FakeCursor(executor)

    def cursor(self):
        return self.cursor_obj


class FakeConnManager:
    def __init__(self, executor):
        self.conn = FakeConn(executor)

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        return False


async def async_noop(*args, **kwargs):
    return None


class AccountAndAiRouterTests(unittest.TestCase):
    def test_signup_login_and_me_return_workspace_context(self):
        user_row = {"id": "user-1", "name": "Ada", "email": "ada@example.com", "password_hash": "hash", "active_tenant_id": None}
        membership_rows = [{"tenant_id": "tenant-1", "role": "OWNER", "tenant_name": "Grabbit", "tenant_slug": "grabbit"}]

        def executor(query, params):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("select id, name, email, password_hash, active_tenant_id from users where email = %s"):
                return None
            if normalized.startswith("insert into users"):
                return user_row
            return None

        with patch("app.routers.auth.get_conn", return_value=FakeConnManager(executor)), patch("app.routers.auth.hash_password", return_value="hashed"), patch("app.routers.auth.create_token", return_value="token-1"), patch("app.routers.auth.memberships_for_user", return_value=membership_rows), patch("app.routers.auth.verify_password", return_value=True), patch("app.routers.auth.fetch_one", return_value=user_row):
            signup_result = signup(SignupRequest(name="Ada", email="ada@example.com", password="secret123"))
            login_result = login(LoginRequest(email="ada@example.com", password="secret123"))

        self.assertEqual(signup_result["user"]["role"], "OWNER")
        self.assertEqual(login_result["user"]["tenant_name"], "Grabbit")

        with patch("app.routers.auth.memberships_for_user", return_value=membership_rows):
            me_result = auth_me(current_user={"id": "user-1", "name": "Ada", "email": "ada@example.com", "active_tenant_id": "tenant-1", "role": "OWNER"})
        self.assertEqual(me_result["user"]["role"], "OWNER")

    def test_signup_handles_existing_email_conflict(self):
        user_row = {"id": "user-1", "name": "Ada", "email": "ada@example.com", "password_hash": "hash", "active_tenant_id": None}
        with patch("app.routers.auth.get_conn", return_value=FakeConnManager(lambda q, p: user_row if "select id, name, email, password_hash, active_tenant_id from users where email = %s" in " ".join(q.split()).lower() else None)), patch("app.routers.auth.hash_password", return_value="hashed"), patch("app.routers.auth.verify_password", return_value=False):
            with self.assertRaises(HTTPException):
                signup(SignupRequest(name="Ada", email="ada@example.com", password="secret123"))

    def test_tenant_helpers_return_memberships_and_current_tenant(self):
        with patch("app.routers.tenants.memberships_for_user", return_value=[{"tenant_id": "tenant-1", "role": "OWNER", "tenant_name": "Grabbit", "tenant_slug": "grabbit"}]):
            result = my_tenants(current_user={"id": "user-1", "active_tenant_id": "tenant-1"})
        self.assertEqual(result["tenants"][0]["tenant_id"], "tenant-1")
        self.assertEqual(resolve_tenant_id({"tenant_id": "tenant-1"}), "tenant-1")

        with patch("app.routers.tenants.fetch_one", return_value={"id": "tenant-1", "name": "Grabbit", "slug": "grabbit"}):
            current = current_tenant(current_user={"tenant_id": "tenant-1"})
        self.assertEqual(current["tenant"]["name"], "Grabbit")

        with patch("app.routers.tenants.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.tenants.fetch_all", return_value=[{"id": "user-1", "name": "Ada", "role": "OWNER", "status": "ACTIVE", "joined_at": "2026-06-23T00:00:00+00:00"}]):
            members_result = members("tenant-1", current_user={"tenant_id": "tenant-1"})
        self.assertEqual(members_result["members"][0]["role"], "OWNER")

    def test_create_tenant_conflict_and_default_invite_paths(self):
        tenant_row = {"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": "invite-1", "invite_enabled": True}
        membership_row = {"tenant_id": "tenant-1", "user_id": "user-1", "role": "OWNER", "status": "ACTIVE", "joined_at": "2026-06-23T00:00:00+00:00"}
        executed = []

        def executor(query, params):
            normalized = " ".join(query.split()).lower()
            executed.append(normalized)
            if normalized.startswith("insert into tenants"):
                return tenant_row
            if normalized.startswith("insert into tenant_members"):
                return membership_row
            if normalized.startswith("update users set active_tenant_id"):
                return None
            return None

        with patch("app.routers.tenants.fetch_one", return_value=None), patch("app.routers.tenants.get_conn", return_value=FakeConnManager(executor)), patch("app.routers.tenants.ensure_workspace_invite", return_value=tenant_row), patch("app.routers.tenants.create_token", return_value="token-1"), patch("app.routers.tenants.invite_url_for_tenant", return_value="/invite/invite-1"):
            created = create_tenant(TenantCreate(name="Grabbit"), current_user={"id": "user-1", "role": "OWNER"})
        self.assertEqual(created["tenant"]["id"], "tenant-1")
        self.assertIn("insert into tenants", executed[0])

        def conflict_executor(query, params):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("insert into tenants"):
                class Conflict(Exception):
                    sqlstate = "23505"
                raise Conflict()
            return None

        with patch("app.routers.tenants.fetch_one", return_value=None), patch("app.routers.tenants.get_conn", return_value=FakeConnManager(conflict_executor)):
            with self.assertRaises(HTTPException):
                create_tenant(TenantCreate(name="Grabbit"), current_user={"id": "user-1", "role": "OWNER"})

    def test_users_me_and_set_active_tenant(self):
        memberships = [{"tenant_id": "tenant-1", "role": "OWNER", "tenant_name": "Grabbit", "tenant_slug": "grabbit"}]
        with patch("app.routers.users.memberships_for_user", return_value=memberships), patch("app.routers.users.active_membership_for_user", return_value=memberships[0]):
            result = user_me(current_user={"id": "user-1", "name": "Ada", "email": "ada@example.com", "active_tenant_id": "tenant-1", "role": "OWNER"})
        self.assertEqual(result["user"]["tenant_slug"], "grabbit")

        def executor(query, params):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("update users set active_tenant_id"):
                return {"active_tenant_id": "tenant-1"}
            return None

        with patch("app.routers.users.fetch_one", return_value={"role": "OWNER", "id": "tenant-1", "name": "Grabbit", "slug": "grabbit"}), patch("app.routers.users.get_conn", return_value=FakeConnManager(executor)), patch("app.routers.users.create_token", return_value="token-1"), patch("app.routers.users.memberships_for_user", return_value=memberships):
            response = set_active_tenant(ActiveTenantRequest(tenant_id="tenant-1"), current_user={"id": "user-1", "active_tenant_id": None})
        self.assertEqual(response["active_tenant_id"], "tenant-1")

    def test_users_me_falls_back_to_current_role_when_no_memberships(self):
        with patch("app.routers.users.memberships_for_user", return_value=[]):
            result = user_me(current_user={"id": "user-1", "name": "Ada", "email": "ada@example.com", "active_tenant_id": None, "role": "OWNER", "tenant_name": "Grabbit", "tenant_slug": "grabbit"})
        self.assertEqual(result["user"]["role"], "OWNER")

    def test_ai_helpers_and_plans(self):
        self.assertEqual(breakdown(type("P", (), {"prompt": "Improve onboarding flow"})(), current_user={"tenant_id": "tenant-1"})["mode"], "heuristic")
        self.assertIn("heuristic", acceptance_criteria(type("P", (), {"title": "Create task"})(), current_user={"tenant_id": "tenant-1"})["mode"])

        with patch("app.routers.ai.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.ai.fetch_one", return_value={"id": "project-1"}), patch("app.routers.ai.fetch_all", return_value=[{"id": "issue-1", "priority": "HIGH", "story_points": 3, "status": "BACKLOG"}]):
            plan = sprint_plan(type("P", (), {"project_id": "project-1", "sprint_id": None, "capacity_points": 5})(), current_user={"tenant_id": "tenant-1"})
        self.assertEqual(plan["planned_points"], 3)

        with patch("app.routers.ai.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.ai.fetch_one", side_effect=[{"id": "sprint-1"}, {"total": 2, "done": 1, "blocked": 0, "points": 5, "done_points": 3}]):
            insights = sprint_insights(type("P", (), {"project_id": "project-1", "sprint_id": "sprint-1", "capacity_points": 5})(), current_user={"tenant_id": "tenant-1"})
        self.assertEqual(insights["sprint"]["id"], "sprint-1")

    def test_get_invite_handles_disabled_and_enabled_links(self):
        with patch("app.routers.invites.fetch_one", return_value={"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": "invite-1", "invite_enabled": False}):
            with self.assertRaises(HTTPException):
                get_invite("invite-1")

        with patch("app.routers.invites.fetch_one", return_value={"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": "invite-1", "invite_enabled": True}):
            invite = get_invite("invite-1")
        self.assertEqual(invite["invite_code"], "invite-1")

    def test_workspace_invite_controls_and_member_removal(self):
        tenant = {"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": "invite-1", "invite_enabled": True, "invite_created_at": "2026-06-23T00:00:00+00:00"}
        with patch("app.routers.tenants.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.tenants.ensure_workspace_invite", return_value=tenant):
            invite = get_invite_link("tenant-1", current_user={"id": "user-1", "role": "OWNER", "tenant_id": "tenant-1"})
            regenerated = regenerate_invite_link("tenant-1", current_user={"id": "user-1", "role": "OWNER", "tenant_id": "tenant-1"})
        self.assertEqual(invite["invite_url"], "/invite/invite-1")
        self.assertEqual(regenerated["invite_url"], "/invite/invite-1")

        with patch("app.routers.tenants.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.tenants.execute", return_value={"id": "tenant-1", "invite_enabled": False, "invite_code": "invite-1"}):
            revoked = revoke_invite_link("tenant-1", current_user={"id": "user-1", "role": "OWNER", "tenant_id": "tenant-1"})
        self.assertEqual(revoked["invite_url"], "")

        def executor(query, params):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("delete from tenant_members"):
                return {"tenant_id": "tenant-1", "user_id": "user-2", "role": "MEMBER"}
            if normalized.startswith("update users set active_tenant_id = null"):
                return None
            return None

        with patch("app.routers.tenants.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.tenants.fetch_one", return_value={"role": "MEMBER", "name": "Ada", "email": "ada@example.com"}), patch("app.routers.tenants.execute", side_effect=lambda query, params=(): executor(query, params)), patch("app.routers.tenants.record_activity"), patch("app.routers.tenants.event_bus.publish", new=async_noop):
            result = asyncio.run(remove_member("tenant-1", "user-2", current_user={"id": "user-1", "role": "ADMIN", "tenant_id": "tenant-1"}))
        self.assertTrue(result["ok"])

    def test_member_removal_and_invite_accept_edge_cases(self):
        with patch("app.routers.tenants.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.tenants.fetch_one", return_value={"role": "OWNER", "name": "Ada", "email": "ada@example.com"}):
            with self.assertRaises(HTTPException):
                asyncio.run(remove_member("tenant-1", "user-1", current_user={"id": "user-1", "role": "OWNER", "tenant_id": "tenant-1"}))

        with patch("app.routers.invites.fetch_one", side_effect=[None]):
            with self.assertRaises(HTTPException):
                accept_invite("missing-code", current_user={"id": "user-1"})

        with patch("app.routers.invites.fetch_one", side_effect=[{"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": "invite-1", "invite_enabled": False}]):
            with self.assertRaises(HTTPException):
                accept_invite("invite-1", current_user={"id": "user-1"})

    def test_user_active_tenant_missing_membership_raises(self):
        with patch("app.routers.users.fetch_one", return_value=None):
            with self.assertRaises(HTTPException):
                set_active_tenant(ActiveTenantRequest(tenant_id="tenant-1"), current_user={"id": "user-1"})


if __name__ == "__main__":
    unittest.main()
