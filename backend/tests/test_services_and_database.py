import json
import sys
import types
import unittest
from datetime import date
from unittest.mock import MagicMock, patch

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
            self.closed = False
            self._conn = None

        def connection(self):
            return self._conn

        def close(self):
            self.closed = True

    psycopg_pool.ConnectionPool = ConnectionPool
    sys.modules["psycopg_pool"] = psycopg_pool

from app import database
from app.services.activity import record_activity
from app.services.memberships import active_membership_for_user, memberships_for_user
from app.services.workspace_defaults import (
    _month_bounds,
    _month_name,
    _next_month_start,
    ensure_current_monthly_sprint,
    ensure_default_project,
    ensure_workspace_board_defaults,
    ensure_workspace_invite,
    get_workspace_sprint_schedule,
    invite_url_for_tenant,
)


class FakeCursor:
    def __init__(self, execute_fn):
        self.execute_fn = execute_fn
        self.executed = []
        self.fetchone_result = None
        self.fetchall_result = []
        self.description = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=()):
        self.executed.append((query, params))
        result = self.execute_fn(query, params)
        if isinstance(result, dict) and result.get("fetchall") is not None:
            self.fetchall_result = result["fetchall"]
            self.fetchone_result = result.get("fetchone")
            self.description = result.get("description")
            return
        self.fetchone_result = result
        self.description = [1] if result is not None else None

    def fetchone(self):
        return self.fetchone_result

    def fetchall(self):
        return self.fetchall_result


class FakeConn:
    def __init__(self, execute_fn):
        self.cursor_obj = FakeCursor(execute_fn)
        self.committed = False
        self.rolled_back = False

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


class FakeConnContext:
    def __init__(self, execute_fn):
        self.conn = FakeConn(execute_fn)

    def __enter__(self):
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        return False


class FakePool:
    def __init__(self, execute_fn):
        self.execute_fn = execute_fn
        self.closed = False

    def connection(self):
        return FakeConnContext(self.execute_fn)

    def close(self):
        self.closed = True


class ServiceAndDatabaseTests(unittest.TestCase):
    def test_month_helpers_cover_boundaries(self):
        self.assertEqual(_month_bounds(date(2024, 2, 29)), (date(2024, 2, 1), date(2024, 2, 29)))
        self.assertEqual(_next_month_start(date(2026, 12, 15)), date(2027, 1, 1))
        self.assertEqual(_month_name(date(2026, 6, 23)), "June 2026")

    def test_memberships_query_and_selection(self):
        rows = [
            {"tenant_id": "t1", "role": "MEMBER", "tenant_name": "One", "tenant_slug": "one"},
            {"tenant_id": "t2", "role": "OWNER", "tenant_name": "Two", "tenant_slug": "two"},
        ]
        with patch("app.services.memberships.fetch_all", return_value=rows) as mock_fetch_all:
            result = memberships_for_user("user-1")
            self.assertEqual(result, rows)
            mock_fetch_all.assert_called_once()
        self.assertEqual(active_membership_for_user("user-1", "t2", rows)["tenant_id"], "t2")
        self.assertEqual(active_membership_for_user("user-1", None, rows)["tenant_id"], "t1")
        self.assertIsNone(active_membership_for_user("user-1", None, []))

    def test_record_activity_serializes_metadata(self):
        captured = {}

        def fake_execute(query, params):
            captured["query"] = query
            captured["params"] = params
            return {"id": "event-1"}

        with patch("app.services.activity.execute", side_effect=fake_execute):
            result = record_activity(
                "tenant-1",
                "user-1",
                "issue_created",
                "Created issue",
                project_id="project-1",
                issue_id="issue-1",
                sprint_id="sprint-1",
                metadata={"score": 4, "tags": ["a", "b"]},
            )

        self.assertEqual(result["id"], "event-1")
        self.assertIn("INSERT INTO activity_events", captured["query"])
        self.assertEqual(json.loads(captured["params"][-1]), {"score": 4, "tags": ["a", "b"]})

    @patch("app.services.workspace_defaults.fetch_one")
    def test_invite_url_and_invite_generation_are_idempotent(self, mock_fetch_one):
        mock_fetch_one.side_effect = [
            {"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": None, "invite_enabled": True, "invite_created_at": None},
            None,
        ]

        def execute_fn(query, params=()):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("update tenants set"):
                return {"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": "invite-1", "invite_enabled": True}
            return None

        with patch("app.services.workspace_defaults._generate_invite_code", side_effect=["invite-1"]), patch("app.services.workspace_defaults.get_conn", return_value=FakeConnContext(execute_fn)):
            tenant = ensure_workspace_invite("tenant-1")
            self.assertEqual(tenant["invite_code"], "invite-1")
            self.assertEqual(invite_url_for_tenant(tenant), "/invite/invite-1")

    @patch("app.services.workspace_defaults.fetch_one")
    def test_invite_url_is_hidden_when_disabled(self, mock_fetch_one):
        self.assertEqual(invite_url_for_tenant({"id": "tenant-1", "invite_code": "invite-1", "invite_enabled": False}), "")
        mock_fetch_one.assert_not_called()

    @patch("app.services.workspace_defaults.get_conn")
    @patch("app.services.workspace_defaults.fetch_one")
    def test_ensure_workspace_invite_reuses_existing_enabled_link(self, mock_fetch_one, mock_get_conn):
        tenant = {"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": "invite-1", "invite_enabled": True, "invite_created_at": "2026-06-23T00:00:00+00:00"}
        mock_fetch_one.return_value = tenant
        result = ensure_workspace_invite("tenant-1")
        self.assertEqual(result, tenant)
        mock_fetch_one.assert_called_once()
        mock_get_conn.assert_not_called()

    @patch("app.services.workspace_defaults.fetch_one")
    def test_ensure_workspace_invite_retries_on_unique_conflict(self, mock_fetch_one):
        mock_fetch_one.side_effect = [
            {"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": None, "invite_enabled": True, "invite_created_at": None},
            None,
            None,
            None,
        ]

        class UniqueViolation(Exception):
            sqlstate = "23505"

        execute_calls = {"count": 0}

        def execute_fn(query, params=()):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("update tenants set"):
                execute_calls["count"] += 1
                if execute_calls["count"] == 1:
                    raise UniqueViolation()
                return {"id": "tenant-1", "name": "Grabbit", "slug": "grabbit", "invite_code": "invite-2", "invite_enabled": True}
            return None

        with patch("app.services.workspace_defaults._generate_invite_code", side_effect=["invite-1", "invite-2"]), patch("app.services.workspace_defaults.get_conn", return_value=FakeConnContext(execute_fn)):
            result = ensure_workspace_invite("tenant-1", force_new=True)

        self.assertEqual(result["invite_code"], "invite-2")
        self.assertEqual(execute_calls["count"], 2)

    @patch("app.services.workspace_defaults.fetch_one")
    def test_ensure_default_project_reuses_existing_project(self, mock_fetch_one):
        mock_fetch_one.side_effect = [
            {"name": "Grabbit"},
            {"id": "project-1", "tenant_id": "tenant-1", "key": "GRABBIT", "name": "Grabbit"},
        ]
        project = ensure_default_project("tenant-1")
        self.assertEqual(project["id"], "project-1")

    @patch("app.services.workspace_defaults.fetch_one")
    def test_ensure_default_project_creates_and_falls_back_on_race(self, mock_fetch_one):
        mock_fetch_one.side_effect = [
            {"name": "Grabbit"},
            None,
            {"id": "project-1", "tenant_id": "tenant-1", "key": "GRABBIT", "name": "Grabbit"},
        ]

        def execute_fn(query, params=()):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("insert into projects"):
                return None
            if normalized.startswith("select id, tenant_id, name, key, description, visibility, status, issue_counter, created_by, created_at, updated_at from projects where tenant_id = %s and key = %s limit 1"):
                return {"id": "project-1", "tenant_id": "tenant-1", "key": "GRABBIT", "name": "Grabbit"}
            return None

        with patch("app.services.workspace_defaults.get_conn", return_value=FakeConnContext(execute_fn)):
            project = ensure_default_project("tenant-1")

        self.assertEqual(project["id"], "project-1")

    @patch("app.services.workspace_defaults.fetch_one")
    def test_ensure_current_monthly_sprint_returns_none_without_inputs(self, mock_fetch_one):
        self.assertIsNone(ensure_current_monthly_sprint("", "project-1"))
        self.assertIsNone(ensure_current_monthly_sprint("tenant-1", ""))
        mock_fetch_one.assert_not_called()

    @patch("app.services.workspace_defaults.date")
    @patch("app.services.workspace_defaults.get_conn")
    def test_ensure_current_monthly_sprint_reactivates_existing_month(self, mock_get_conn, mock_date):
        mock_date.today.return_value = date(2026, 6, 23)
        mock_date.side_effect = lambda *args, **kwargs: date(*args, **kwargs)

        def execute_fn(query, params=()):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("select pg_advisory_xact_lock"):
                return None
            if normalized.startswith("update sprints set status = 'completed'"):
                return None
            if normalized.startswith("select id, tenant_id, project_id, name, goal, status, start_date, end_date, created_by, issue_count, created_at, updated_at from sprints where tenant_id = %s and project_id = %s and start_date = %s and end_date = %s"):
                return {"id": "sprint-1", "status": "PLANNED", "project_id": "project-1"}
            if normalized.startswith("update sprints set status = 'active'"):
                return {"id": "sprint-1", "status": "ACTIVE", "project_id": "project-1"}
            return None

        mock_get_conn.return_value = FakeConnContext(execute_fn)
        sprint = ensure_current_monthly_sprint("tenant-1", "project-1")
        self.assertEqual(sprint["status"], "ACTIVE")

    @patch("app.services.workspace_defaults.date")
    @patch("app.services.workspace_defaults.get_conn")
    def test_ensure_current_monthly_sprint_creates_new_month_when_missing(self, mock_get_conn, mock_date):
        mock_date.today.return_value = date(2026, 7, 2)
        mock_date.side_effect = lambda *args, **kwargs: date(*args, **kwargs)

        def execute_fn(query, params=()):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("select pg_advisory_xact_lock"):
                return None
            if normalized.startswith("update sprints set status = 'completed'"):
                return None
            if normalized.startswith("select id, tenant_id, project_id, name, goal, status, start_date, end_date, created_by, issue_count, created_at, updated_at from sprints where tenant_id = %s and project_id = %s and start_date = %s and end_date = %s"):
                return None
            if normalized.startswith("insert into sprints"):
                return {"id": "sprint-2", "status": "ACTIVE", "name": "July 2026", "project_id": "project-1"}
            return None

        mock_get_conn.return_value = FakeConnContext(execute_fn)
        sprint = ensure_current_monthly_sprint("tenant-1", "project-1")
        self.assertEqual(sprint["id"], "sprint-2")
        self.assertEqual(sprint["status"], "ACTIVE")

    @patch("app.services.workspace_defaults.date")
    @patch("app.services.workspace_defaults.get_conn")
    def test_ensure_current_monthly_sprint_completes_older_sprints_before_create(self, mock_get_conn, mock_date):
        mock_date.today.return_value = date(2026, 7, 2)
        mock_date.side_effect = lambda *args, **kwargs: date(*args, **kwargs)

        calls = []

        def execute_fn(query, params=()):
            normalized = " ".join(query.split()).lower()
            calls.append(normalized)
            if normalized.startswith("select pg_advisory_xact_lock"):
                return None
            if normalized.startswith("update sprints set status = 'completed'"):
                return None
            if normalized.startswith("select id, tenant_id, project_id, name, goal, status, start_date, end_date, created_by, issue_count, created_at, updated_at from sprints where tenant_id = %s and project_id = %s and start_date = %s and end_date = %s"):
                return None
            if normalized.startswith("insert into sprints"):
                return {"id": "sprint-2", "status": "ACTIVE", "name": "July 2026", "project_id": "project-1"}
            return None

        mock_get_conn.return_value = FakeConnContext(execute_fn)
        sprint = ensure_current_monthly_sprint("tenant-1", "project-1")
        self.assertEqual(sprint["id"], "sprint-2")
        self.assertTrue(any("update sprints set status = 'completed'" in call for call in calls))

    @patch("app.services.workspace_defaults.ensure_default_project")
    @patch("app.services.workspace_defaults.ensure_current_monthly_sprint")
    def test_workspace_defaults_bootstrap_uses_project_then_sprint(self, mock_sprint, mock_project):
        mock_project.return_value = {"id": "project-1"}
        mock_sprint.return_value = {"id": "sprint-1"}
        result = ensure_workspace_board_defaults("tenant-1")
        self.assertEqual(result["project"]["id"], "project-1")
        self.assertEqual(result["sprint"]["id"], "sprint-1")
        mock_project.assert_called_once_with("tenant-1")
        mock_sprint.assert_called_once_with("tenant-1", "project-1")

    @patch("app.services.workspace_defaults.fetch_one")
    @patch("app.services.workspace_defaults.ensure_current_monthly_sprint")
    def test_get_workspace_sprint_schedule_uses_default_project_and_current_sprint(self, mock_sprint, mock_fetch_one):
        mock_fetch_one.side_effect = [
            {"name": "Grabbit"},
            {"id": "project-1", "tenant_id": "tenant-1", "name": "Grabbit", "key": "GRABBIT"},
            {"id": "sprint-1", "project_id": "project-1", "name": "June 2026", "start_date": date(2026, 6, 1)},
            {"id": "sprint-1", "project_id": "project-1", "name": "June 2026", "start_date": date(2026, 6, 1)},
            {"id": "sprint-2", "project_id": "project-1", "name": "July 2026", "start_date": date(2026, 7, 1)},
        ]
        mock_sprint.return_value = {"id": "sprint-1", "project_id": "project-1", "name": "June 2026", "status": "ACTIVE"}
        schedule = get_workspace_sprint_schedule("tenant-1")
        self.assertTrue(schedule["autoSprintEnabled"])
        self.assertEqual(schedule["defaultProject"]["id"], "project-1")
        self.assertEqual(schedule["currentSprint"]["id"], "sprint-1")

    @patch("app.services.workspace_defaults.ensure_current_monthly_sprint")
    @patch("app.services.workspace_defaults.fetch_one")
    def test_get_workspace_sprint_schedule_uses_upcoming_sprint_when_present(self, mock_fetch_one, mock_sprint):
        def fetch_one_side_effect(query, params=()):
            normalized = " ".join(query.split()).lower()
            if normalized.startswith("select id, tenant_id, name, key, description, visibility, status, issue_counter, created_by, created_at, updated_at from projects where id = %s and tenant_id = %s"):
                return {"id": "project-1", "tenant_id": "tenant-1", "name": "Grabbit", "key": "GRABBIT"}
            if "order by created_at desc" in normalized:
                return {"id": "sprint-last", "project_id": "project-1", "name": "June 2026", "start_date": date(2026, 6, 1)}
            if "start_date > %s" in normalized:
                return {"id": "sprint-next", "project_id": "project-1", "name": "July 2026", "start_date": date(2026, 7, 1)}
            raise AssertionError(f"Unexpected query: {query}")

        mock_fetch_one.side_effect = fetch_one_side_effect
        mock_sprint.return_value = {"id": "sprint-current", "project_id": "project-1", "name": "June 2026", "status": "ACTIVE"}

        schedule = get_workspace_sprint_schedule("tenant-1", "project-1")

        self.assertEqual(schedule["nextSprintName"], "July 2026")
        self.assertEqual(schedule["nextCreationDate"], "2026-07-01")
        self.assertEqual(schedule["currentSprint"]["id"], "sprint-current")
        self.assertEqual(schedule["lastCreatedSprint"]["id"], "sprint-last")

    def test_database_fetch_and_execute_helpers_use_queries_and_commit(self):
        calls = []

        def execute_fn(query, params):
            calls.append((query, params))
            if query.startswith("SELECT"):
                return {"id": "row-1"}
            if "RETURNING" in query:
                return {"ok": True}
            return None

        pool = FakePool(execute_fn)
        original_pool = database.pool
        database.pool = pool
        try:
            row = database.fetch_one("SELECT * FROM table WHERE id = %s", ("1",))
            rows = database.fetch_all("SELECT * FROM table", ())
            result = database.execute("INSERT INTO table VALUES (%s) RETURNING *", ("x",))
            no_result = database.execute("UPDATE table SET x = 1", ())
        finally:
            database.pool = original_pool

        self.assertEqual(row, {"id": "row-1"})
        self.assertEqual(rows, [])
        self.assertEqual(result, {"ok": True})
        self.assertIsNone(no_result)
        self.assertGreaterEqual(len(calls), 4)

    def test_database_init_and_close_pool(self):
        class PoolFactory:
            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs
                self.closed = False

            def close(self):
                self.closed = True

            def connection(self):
                raise AssertionError("not used")

        original_pool = database.pool
        original_connection_pool = database.ConnectionPool
        original_settings = database.get_settings
        try:
            database.pool = None
            database.ConnectionPool = PoolFactory
            database.get_settings = lambda: types.SimpleNamespace(database_url="postgres://example")
            database.init_pool()
            self.assertIsNotNone(database.pool)
            database.close_pool()
            self.assertIsNone(database.pool)
        finally:
            database.pool = original_pool
            database.ConnectionPool = original_connection_pool
            database.get_settings = original_settings


if __name__ == "__main__":
    unittest.main()
