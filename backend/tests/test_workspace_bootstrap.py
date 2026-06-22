import asyncio
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import patch

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

        def close(self):
            return None

    psycopg_pool.ConnectionPool = ConnectionPool
    sys.modules["psycopg_pool"] = psycopg_pool

from app.routers.invites import accept_invite
from app.routers.projects import ProjectCreate, create_project
from app.routers.sprints import sprint_schedule
from app.routers.tenants import TenantCreate, create_tenant
from app.routers.workspaces import board_defaults as workspace_board_defaults
from app.routers.workspaces import schedule as workspace_schedule
from app.routers.tenants import my_tenants
from app.routers.users import ActiveTenantRequest, set_active_tenant
from app.security import get_current_user
from app.services.memberships import active_membership_for_user
from app.services.workspace_defaults import ensure_default_project, ensure_workspace_board_defaults


class FakeCursor:
    def __init__(self, resolver):
        self.resolver = resolver
        self.executed = []
        self.current = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=()):
        self.executed.append((query, params))
        self.current = self.resolver(query, params)

    def fetchone(self):
        return self.current


class FakeConn:
    def __init__(self, resolver):
        self.cursor_obj = FakeCursor(resolver)

    def cursor(self):
        return self.cursor_obj


class FakeConnManager:
    def __init__(self, resolver):
        self.conn = FakeConn(resolver)

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        return False


class WorkspaceBootstrapTests(unittest.TestCase):
    def test_active_membership_prefers_active_tenant(self):
        memberships = [
            {"tenant_id": "t1", "role": "MEMBER", "tenant_name": "One", "tenant_slug": "one"},
            {"tenant_id": "t2", "role": "OWNER", "tenant_name": "Two", "tenant_slug": "two"},
        ]
        active = active_membership_for_user("user-1", "t2", memberships)
        self.assertEqual(active["tenant_id"], "t2")
        self.assertEqual(active["role"], "OWNER")

    def test_ensure_default_project_returns_none_without_tenant(self):
        self.assertIsNone(ensure_default_project(""))

    @patch("app.services.workspace_defaults.get_conn")
    @patch("app.services.workspace_defaults.fetch_one")
    def test_ensure_default_project_reuses_existing_row(self, mock_fetch_one, mock_get_conn):
        mock_fetch_one.side_effect = [
            {"id": "tenant-1", "name": "Grabbit"},
            {"id": "project-1", "tenant_id": "tenant-1", "key": "GRABBIT", "name": "Grabbit"},
        ]
        project = ensure_default_project("tenant-1")
        self.assertEqual(project["id"], "project-1")
        mock_get_conn.assert_not_called()

    @patch("app.security.memberships_for_user")
    @patch("app.security.fetch_one")
    @patch("app.security.decode_token")
    def test_get_current_user_resolves_single_membership(self, mock_decode, mock_fetch_one, mock_memberships_for_user):
        mock_decode.return_value = {"sub": "user-1"}
        mock_fetch_one.side_effect = [
            {"id": "user-1", "name": "Ada", "email": "ada@example.com", "active_tenant_id": None, "tenant_id": None, "role": None, "tenant_name": None, "tenant_slug": None},
            {"id": "user-1", "name": "Ada", "email": "ada@example.com", "active_tenant_id": None, "tenant_id": None, "role": None, "tenant_name": None, "tenant_slug": None},
        ]
        mock_memberships_for_user.return_value = [
            {"tenant_id": "tenant-1", "role": "OWNER", "tenant_name": "Grabbit", "tenant_slug": "grabbit"}
        ]
        request = SimpleNamespace(query_params={"token": "test-token"})
        current_user = get_current_user(request, credentials=None)
        self.assertEqual(current_user["tenant_id"], "tenant-1")
        self.assertEqual(current_user["role"], "OWNER")
        self.assertEqual(current_user["tenant_name"], "Grabbit")

    @patch("app.security.memberships_for_user")
    @patch("app.security.fetch_one")
    @patch("app.security.decode_token")
    def test_get_current_user_with_multiple_memberships_skips_extra_lookup(self, mock_decode, mock_fetch_one, mock_memberships_for_user):
        mock_decode.return_value = {"sub": "user-1"}
        mock_fetch_one.return_value = {"id": "user-1", "name": "Ada", "email": "ada@example.com", "active_tenant_id": None, "tenant_id": None, "role": None, "tenant_name": None, "tenant_slug": None}
        mock_memberships_for_user.return_value = [
            {"tenant_id": "tenant-1", "role": "OWNER", "tenant_name": "Grabbit", "tenant_slug": "grabbit"},
            {"tenant_id": "tenant-2", "role": "MEMBER", "tenant_name": "Orbit", "tenant_slug": "orbit"},
        ]
        request = SimpleNamespace(query_params={"token": "test-token"})
        current_user = get_current_user(request, credentials=None)
        self.assertEqual(mock_fetch_one.call_count, 1)
        self.assertIsNone(current_user["tenant_id"])
        self.assertIsNone(current_user["role"])

    @patch("app.routers.tenants.invite_url_for_tenant", return_value="/invite/invite-1")
    @patch("app.routers.tenants.create_token", return_value="token-1")
    @patch("app.routers.tenants.ensure_workspace_invite")
    @patch("app.routers.tenants.get_conn")
    @patch("app.routers.tenants.fetch_one")
    def test_create_tenant_uses_inserted_tenant_id_for_owner_membership(
        self,
        mock_fetch_one,
        mock_get_conn,
        mock_ensure_workspace_invite,
        mock_create_token,
        mock_invite_url_for_tenant,
    ):
        mock_fetch_one.return_value = None
        tenant_row = {"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": "invite-1", "invite_enabled": True}
        membership_row = {"tenant_id": "tenant-1", "user_id": "user-1", "role": "OWNER", "status": "ACTIVE", "joined_at": "2026-06-23T00:00:00+00:00"}
        executed = []

        def resolver(query, params):
            normalized = " ".join(query.split()).lower()
            executed.append((normalized, params))
            if normalized.startswith("insert into tenants"):
                return tenant_row
            if normalized.startswith("insert into tenant_members"):
                self.assertEqual(params[0], tenant_row["id"])
                return membership_row
            if normalized.startswith("update users set active_tenant_id"):
                self.assertEqual(params[0], tenant_row["id"])
                self.assertEqual(params[1], "user-1")
                return None
            return None

        mock_get_conn.return_value = FakeConnManager(resolver)
        mock_ensure_workspace_invite.return_value = tenant_row

        response = create_tenant(TenantCreate(name="Grabbit"), current_user={"id": "user-1"})

        self.assertEqual(response["tenant"]["id"], "tenant-1")
        self.assertEqual(response["membership"]["role"], "OWNER")
        self.assertEqual(response["access_token"], "token-1")
        self.assertEqual(response["invite_url"], "/invite/invite-1")
        mock_ensure_workspace_invite.assert_called_once_with("tenant-1")
        self.assertTrue(any("insert into tenants" in query for query, _ in executed))
        self.assertTrue(any("insert into tenant_members" in query for query, _ in executed))

    @patch("app.routers.invites.memberships_for_user", return_value=[
        {"tenant_id": "tenant-1", "role": "MEMBER", "tenant_name": "Grabbit", "tenant_slug": "grabbit"}
    ])
    @patch("app.routers.invites.create_token", return_value="token-accept")
    @patch("app.routers.invites.get_conn")
    @patch("app.routers.invites.execute")
    @patch("app.routers.invites.fetch_one")
    def test_accept_invite_marks_new_member_as_not_already_member(
        self,
        mock_fetch_one,
        mock_execute,
        mock_get_conn,
        mock_create_token,
        mock_memberships_for_user,
    ):
        tenant_row = {"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": "invite-1", "invite_enabled": True}
        membership_row = {"tenant_id": "tenant-1", "user_id": "user-1", "role": "MEMBER", "status": "ACTIVE"}
        mock_fetch_one.side_effect = [tenant_row, None]

        def resolver(query, params):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("update users set active_tenant_id"):
                return {"active_tenant_id": "tenant-1"}
            return None

        mock_execute.return_value = membership_row
        mock_get_conn.return_value = FakeConnManager(resolver)

        response = accept_invite("invite-1", current_user={"id": "user-1"})

        self.assertFalse(response["already_member"])
        self.assertEqual(response["active_tenant_id"], "tenant-1")
        self.assertEqual(response["membership"]["role"], "MEMBER")
        self.assertEqual(response["access_token"], "token-accept")
        mock_execute.assert_called_once()
        mock_memberships_for_user.assert_called_once_with("user-1")

    @patch("app.routers.invites.memberships_for_user", return_value=[
        {"tenant_id": "tenant-1", "role": "OWNER", "tenant_name": "Grabbit", "tenant_slug": "grabbit"}
    ])
    @patch("app.routers.invites.create_token", return_value="token-existing")
    @patch("app.routers.invites.get_conn")
    @patch("app.routers.invites.execute")
    @patch("app.routers.invites.fetch_one")
    def test_accept_invite_existing_member_does_not_reinsert_membership(
        self,
        mock_fetch_one,
        mock_execute,
        mock_get_conn,
        mock_create_token,
        mock_memberships_for_user,
    ):
        tenant_row = {"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": "invite-1", "invite_enabled": True}
        existing_membership = {"tenant_id": "tenant-1", "user_id": "user-1", "role": "OWNER", "status": "ACTIVE"}
        mock_fetch_one.side_effect = [tenant_row, existing_membership]

        def resolver(query, params):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("update users set active_tenant_id"):
                return {"active_tenant_id": "tenant-1"}
            return None

        mock_get_conn.return_value = FakeConnManager(resolver)

        response = accept_invite("invite-1", current_user={"id": "user-1"})

        self.assertTrue(response["already_member"])
        self.assertEqual(response["membership"]["role"], "OWNER")
        self.assertEqual(response["access_token"], "token-existing")
        mock_execute.assert_not_called()
        mock_memberships_for_user.assert_called_once_with("user-1")

    @patch("app.services.workspace_defaults.ensure_default_project")
    @patch("app.services.workspace_defaults.ensure_current_monthly_sprint")
    def test_workspace_defaults_short_circuit_without_tenant(self, mock_sprint, mock_project):
        result = ensure_workspace_board_defaults("")
        self.assertEqual(result, {"project": None, "sprint": None})
        mock_project.assert_not_called()
        mock_sprint.assert_not_called()

    @patch("app.routers.workspaces.ensure_workspace_board_defaults")
    def test_workspace_board_route_returns_defaults_for_active_tenant(self, mock_defaults):
        mock_defaults.return_value = {"project": {"id": "project-1"}, "sprint": {"id": "sprint-1"}}
        result = workspace_board_defaults(current_user={"tenant_id": "tenant-1", "active_tenant_id": None})
        self.assertEqual(result["project"]["id"], "project-1")
        self.assertEqual(result["sprint"]["id"], "sprint-1")
        mock_defaults.assert_called_once_with("tenant-1")

    @patch("app.routers.workspaces.get_workspace_sprint_schedule")
    def test_workspace_schedule_route_uses_current_tenant(self, mock_schedule):
        mock_schedule.return_value = {"autoSprintEnabled": True, "frequency": "Monthly"}
        result = workspace_schedule(current_user={"active_tenant_id": "tenant-2", "tenant_id": None})
        self.assertTrue(result["autoSprintEnabled"])
        self.assertEqual(result["frequency"], "Monthly")
        mock_schedule.assert_called_once_with("tenant-2")

    @patch("app.routers.sprints.get_workspace_sprint_schedule")
    @patch("app.routers.sprints.ensure_workspace_board_defaults")
    def test_sprint_schedule_route_bootstraps_defaults_once(self, mock_defaults, mock_schedule):
        mock_schedule.return_value = {"autoSprintEnabled": True, "frequency": "Monthly"}
        result = sprint_schedule(current_user={"tenant_id": "tenant-3", "active_tenant_id": None})
        self.assertTrue(result["autoSprintEnabled"])
        mock_defaults.assert_called_once_with("tenant-3")
        mock_schedule.assert_called_once_with("tenant-3", None)

    @patch("app.routers.tenants.memberships_for_user", return_value=[
        {"tenant_id": "tenant-1", "role": "OWNER", "tenant_name": "Grabbit", "tenant_slug": "grabbit"},
        {"tenant_id": "tenant-2", "role": "MEMBER", "tenant_name": "Orbit", "tenant_slug": "orbit"},
    ])
    def test_my_tenants_returns_memberships_and_active_tenant(self, mock_memberships_for_user):
        result = my_tenants(current_user={"id": "user-1", "active_tenant_id": "tenant-2"})
        self.assertEqual(result["active_tenant_id"], "tenant-2")
        self.assertEqual(len(result["tenants"]), 2)
        self.assertEqual(result["tenants"][0]["tenant_id"], "tenant-1")
        mock_memberships_for_user.assert_called_once_with("user-1")

    @patch("app.routers.users.memberships_for_user", return_value=[
        {"tenant_id": "tenant-1", "role": "OWNER", "tenant_name": "Grabbit", "tenant_slug": "grabbit"}
    ])
    @patch("app.routers.users.get_conn")
    @patch("app.routers.users.fetch_one")
    def test_set_active_tenant_returns_updated_session_and_token(self, mock_fetch_one, mock_get_conn, mock_memberships_for_user):
        mock_fetch_one.return_value = {"role": "OWNER", "id": "tenant-1", "name": "Grabbit", "slug": "grabbit"}

        def resolver(query, params):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("update users set active_tenant_id"):
                return {"active_tenant_id": "tenant-1"}
            return None

        mock_get_conn.return_value = FakeConnManager(resolver)

        response = set_active_tenant(ActiveTenantRequest(tenant_id="tenant-1"), current_user={"id": "user-1", "active_tenant_id": None})

        self.assertEqual(response["active_tenant_id"], "tenant-1")
        self.assertEqual(response["membership"]["role"], "OWNER")
        self.assertEqual(response["tenant"]["id"], "tenant-1")
        self.assertEqual(len(response["memberships"]), 1)
        mock_memberships_for_user.assert_called_once_with("user-1")

    @patch("app.routers.projects.event_bus.publish")
    @patch("app.routers.projects.record_activity")
    @patch("app.routers.projects.get_conn")
    @patch("app.routers.projects.fetch_one")
    def test_create_project_reuses_existing_row_on_conflict(self, mock_fetch_one, mock_get_conn, mock_record_activity, mock_publish):
        mock_fetch_one.return_value = None
        project_row = {"id": "project-1", "tenant_id": "tenant-1", "key": "GRABBIT", "name": "Grabbit", "visibility": "EVERYONE"}

        def resolver(query, params):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("insert into projects"):
                return None
            if normalized.startswith("select * from projects where tenant_id = %s and key = %s limit 1"):
                return project_row
            return None

        mock_get_conn.return_value = FakeConnManager(resolver)

        response = asyncio.run(create_project(ProjectCreate(name="Grabbit"), current_user={"id": "user-1", "role": "OWNER", "tenant_id": "tenant-1"}))

        self.assertEqual(response["project"]["id"], "project-1")
        self.assertEqual(response["project"]["key"], "GRABBIT")
        mock_record_activity.assert_called_once()
        mock_publish.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
