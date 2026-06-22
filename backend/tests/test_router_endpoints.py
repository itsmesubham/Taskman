import asyncio
import sys
import types
import unittest
from datetime import date
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

from app.routers.comments import CommentCreate, add_comment, list_comments
from app.routers.issues import IssueCreate, IssueUpdate, create_issue, get_issue, list_issues, reorder_issues, update_issue, update_sprint as apply_sprint, update_status as apply_status
from app.routers.projects import ProjectCreate, ProjectUpdate, archive_project, create_project, list_projects, update_project
from app.routers.reports import dashboard, sprint_report
from app.routers.sprints import CompleteSprintRequest, SprintCreate, SprintUpdate, add_issues_to_sprint, complete_sprint, create_sprint, get_sprint, list_sprints, start_sprint, update_sprint


async def async_noop(*args, **kwargs):
    return None


class RouterTests(unittest.TestCase):
    def test_list_projects_returns_rows(self):
        with patch("app.routers.projects.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.projects.fetch_all", return_value=[{"id": "project-1"}]) as mock_fetch_all:
            result = list_projects(current_user={"tenant_id": "tenant-1"}, include_archived=False)
        self.assertEqual(result["projects"][0]["id"], "project-1")
        mock_fetch_all.assert_called_once()

    def test_list_projects_include_archived_uses_full_filter(self):
        with patch("app.routers.projects.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.projects.fetch_all", return_value=[{"id": "project-1", "status": "ARCHIVED"}]) as mock_fetch_all:
            result = list_projects(current_user={"tenant_id": "tenant-1"}, include_archived=True)
        self.assertEqual(result["projects"][0]["status"], "ARCHIVED")
        mock_fetch_all.assert_called_once()

    def test_list_issues_uses_workspace_defaults_and_filters(self):
        with patch("app.routers.issues.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.issues.ensure_workspace_board_defaults") as mock_defaults, patch("app.routers.issues.fetch_all", return_value=[{"id": "issue-1"}]) as mock_fetch_all:
            result = list_issues(current_user={"tenant_id": "tenant-1"}, project_id="project-1", sprint_id=None, status="TODO", assignee_id="user-1", q="fix")
        self.assertEqual(result["issues"][0]["id"], "issue-1")
        mock_defaults.assert_called_once_with("tenant-1")
        self.assertTrue(mock_fetch_all.called)

    def test_create_issue_uses_default_project_and_monthly_sprint(self):
        fake_issue = {"id": "issue-1", "issue_key": "GRABBIT-1", "title": "Fix bug", "project_id": "project-1"}
        with patch("app.routers.issues.resolve_tenant_id", return_value="tenant-1"), \
             patch("app.routers.issues.validate_issue_values") as mock_validate, \
             patch("app.routers.issues.ensure_workspace_board_defaults") as mock_defaults, \
             patch("app.routers.issues.ensure_project_for_task", return_value={"id": "project-1"}) as mock_project, \
             patch("app.routers.issues.ensure_current_monthly_sprint", return_value={"id": "sprint-1"}) as mock_current_sprint, \
             patch("app.routers.issues.get_conn") as mock_get_conn, \
             patch("app.routers.issues.record_activity") as mock_record_activity, \
             patch("app.routers.issues.event_bus.publish", new=async_noop):
            class Cursor:
                def __init__(self):
                    self.calls = []
                def __enter__(self): return self
                def __exit__(self, exc_type, exc, tb): return False
                def execute(self, query, params=()):
                    self.calls.append((query, params))
                def fetchone(self):
                    if len(self.calls) == 1:
                        return {"issue_counter": 1, "key": "GRABBIT"}
                    if len(self.calls) == 2:
                        return {"next_position": 1000}
                    return fake_issue
            class Conn:
                def cursor(self): return Cursor()
            class Manager:
                def __enter__(self): return Conn()
                def __exit__(self, exc_type, exc, tb): return False
            mock_get_conn.return_value = Manager()
            result = asyncio.run(create_issue(IssueCreate(title="Fix bug", status="TODO"), current_user={"id": "user-1"}))
        self.assertEqual(result["issue"]["id"], "issue-1")
        mock_validate.assert_called_once()
        mock_defaults.assert_called_once_with("tenant-1")
        mock_project.assert_called_once_with("tenant-1", None)
        mock_current_sprint.assert_called_once_with("tenant-1", "project-1")
        mock_record_activity.assert_called_once()

    def test_create_issue_keeps_backlog_without_bootstrapping_monthly_sprint(self):
        fake_issue = {"id": "issue-1", "issue_key": "GRABBIT-1", "title": "Capture idea", "project_id": "project-1", "status": "BACKLOG"}
        with patch("app.routers.issues.resolve_tenant_id", return_value="tenant-1"), \
             patch("app.routers.issues.validate_issue_values"), \
             patch("app.routers.issues.ensure_workspace_board_defaults"), \
             patch("app.routers.issues.ensure_project_for_task", return_value={"id": "project-1"}) as mock_project, \
             patch("app.routers.issues.ensure_current_monthly_sprint") as mock_current_sprint, \
             patch("app.routers.issues.get_conn") as mock_get_conn, \
             patch("app.routers.issues.record_activity") as mock_record_activity, \
             patch("app.routers.issues.event_bus.publish", new=async_noop):
            class Cursor:
                def __init__(self):
                    self.calls = []
                def __enter__(self): return self
                def __exit__(self, exc_type, exc, tb): return False
                def execute(self, query, params=()):
                    self.calls.append((query, params))
                def fetchone(self):
                    if len(self.calls) == 1:
                        return {"issue_counter": 1, "key": "GRABBIT"}
                    if len(self.calls) == 2:
                        return {"next_position": 1000}
                    return fake_issue
            class Conn:
                def cursor(self): return Cursor()
            class Manager:
                def __enter__(self): return Conn()
                def __exit__(self, exc_type, exc, tb): return False
            mock_get_conn.return_value = Manager()
            result = asyncio.run(create_issue(IssueCreate(title="Capture idea", status="BACKLOG"), current_user={"id": "user-1"}))
        self.assertEqual(result["issue"]["status"], "BACKLOG")
        mock_current_sprint.assert_not_called()
        mock_project.assert_called_once_with("tenant-1", None)
        mock_record_activity.assert_called_once()

    def test_update_issue_same_project_updates_in_place(self):
        original = {"id": "issue-1", "issue_key": "GRABBIT-1", "project_id": "project-1", "status": "TODO"}
        updated = {"id": "issue-1", "issue_key": "GRABBIT-1", "project_id": "project-1", "status": "DONE"}
        with patch("app.routers.issues.resolve_tenant_id", return_value="tenant-1"), \
             patch("app.routers.issues.ensure_issue", return_value=original) as mock_issue, \
             patch("app.routers.issues.validate_issue_values") as mock_validate, \
             patch("app.routers.issues.ensure_project") as mock_project, \
             patch("app.routers.issues.ensure_sprint") as mock_sprint, \
             patch("app.routers.issues.execute", return_value=updated) as mock_execute, \
             patch("app.routers.issues.record_activity") as mock_record_activity, \
             patch("app.routers.issues.event_bus.publish", new=async_noop):
            result = asyncio.run(update_issue("issue-1", IssueUpdate(status="DONE"), current_user={"id": "user-1"}))
        self.assertEqual(result["issue"]["status"], "DONE")
        mock_issue.assert_called_once()
        mock_validate.assert_called_once_with(None, "DONE", None)
        mock_project.assert_not_called()
        mock_sprint.assert_not_called()
        mock_execute.assert_called_once()
        mock_record_activity.assert_called_once()

    def test_update_status_and_sprint_assignment_cover_position_branches(self):
        issue = {"id": "issue-1", "issue_key": "GRABBIT-1", "project_id": "project-1", "status": "BACKLOG", "sprint_id": None}
        with patch("app.routers.issues.resolve_tenant_id", return_value="tenant-1"), \
             patch("app.routers.issues.validate_issue_values"), \
             patch("app.routers.issues.ensure_issue", return_value=issue), \
             patch("app.routers.issues.fetch_one", return_value={"next_position": 2500}), \
             patch("app.routers.issues.execute", return_value={"id": "issue-1", "issue_key": "GRABBIT-1", "project_id": "project-1", "status": "DONE"}) as mock_execute, \
             patch("app.routers.issues.record_activity") as mock_record_activity, \
             patch("app.routers.issues.event_bus.publish", new=async_noop):
            result = asyncio.run(apply_status("issue-1", status_payload := type("Status", (), {"status": "DONE", "position": None})(), current_user={"id": "user-1"}))
        self.assertEqual(result["issue"]["status"], "DONE")
        mock_execute.assert_called_once()
        mock_record_activity.assert_called_once()

        with patch("app.routers.issues.resolve_tenant_id", return_value="tenant-1"), \
             patch("app.routers.issues.ensure_issue", return_value=issue), \
             patch("app.routers.issues.validate_issue_values"), \
             patch("app.routers.issues.ensure_sprint", return_value={"id": "sprint-1"}), \
             patch("app.routers.issues.execute", return_value={"id": "issue-1", "issue_key": "GRABBIT-1", "project_id": "project-1", "status": "TODO", "sprint_id": "sprint-1"}) as mock_execute, \
             patch("app.routers.issues.record_activity") as mock_record_activity, \
             patch("app.routers.issues.event_bus.publish", new=async_noop):
            result = asyncio.run(apply_sprint("issue-1", type("SprintAssign", (), {"sprint_id": "sprint-1", "status": None})(), current_user={"id": "user-1"}))
        self.assertEqual(result["issue"]["sprint_id"], "sprint-1")
        mock_execute.assert_called_once()
        mock_record_activity.assert_called_once()

    def test_update_issue_cross_project_rekeys_issue(self):
        original = {"id": "issue-1", "issue_key": "GRABBIT-1", "project_id": "project-1", "status": "TODO"}
        updated = {"id": "issue-1", "issue_key": "ORBIT-2", "project_id": "project-2", "status": "TODO"}
        with patch("app.routers.issues.resolve_tenant_id", return_value="tenant-1"), \
             patch("app.routers.issues.ensure_issue", return_value=original), \
             patch("app.routers.issues.validate_issue_values"), \
             patch("app.routers.issues.ensure_project", side_effect=[{"id": "project-2", "key": "ORBIT"}, {"id": "project-2", "key": "ORBIT"}]) as mock_project, \
             patch("app.routers.issues.ensure_sprint"), \
             patch("app.routers.issues.ensure_current_monthly_sprint", return_value={"id": "sprint-9"}), \
             patch("app.routers.issues.get_conn") as mock_get_conn, \
             patch("app.routers.issues.record_activity") as mock_record_activity, \
             patch("app.routers.issues.event_bus.publish", new=async_noop):
            class Cursor:
                def __init__(self):
                    self.calls = 0
                def __enter__(self): return self
                def __exit__(self, exc_type, exc, tb): return False
                def execute(self, query, params=()):
                    self.calls += 1
                def fetchone(self):
                    if self.calls == 1:
                        return {"issue_counter": 2, "key": "ORBIT"}
                    return updated
            class Conn:
                def cursor(self): return Cursor()
            class Manager:
                def __enter__(self): return Conn()
                def __exit__(self, exc_type, exc, tb): return False
            mock_get_conn.return_value = Manager()
            result = asyncio.run(update_issue("issue-1", IssueUpdate(project_id="project-2"), current_user={"id": "user-1"}))
        self.assertEqual(result["issue"]["issue_key"], "ORBIT-2")
        self.assertEqual(result["issue"]["project_id"], "project-2")
        self.assertGreaterEqual(mock_project.call_count, 1)
        mock_record_activity.assert_called_once()

    def test_reorder_issues_updates_rows(self):
        with patch("app.routers.issues.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.issues.validate_issue_values") as mock_validate, patch("app.routers.issues.ensure_issue", return_value={"status": "BACKLOG", "sprint_id": None}) as mock_issue, patch("app.routers.issues.execute", return_value={"id": "issue-1"}) as mock_execute, patch("app.routers.issues.record_activity") as mock_record_activity, patch("app.routers.issues.event_bus.publish", new=async_noop):
            result = asyncio.run(reorder_issues(type("Payload", (), {"items": [type("Item", (), {"id": "issue-1", "status": "TODO", "position": 1000, "sprint_id": None})()]})(), current_user={"id": "user-1"}))
        self.assertEqual(result["issues"][0]["id"], "issue-1")
        mock_validate.assert_called_once_with(status="TODO")
        mock_issue.assert_called_once()
        mock_execute.assert_called_once()
        mock_record_activity.assert_called_once()

    def test_comments_list_and_add_comment(self):
        with patch("app.routers.comments.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.comments.ensure_issue", return_value={"issue_key": "GRABBIT-1", "project_id": "project-1"}), patch("app.routers.comments.fetch_all", return_value=[{"id": "comment-1"}]) as mock_fetch_all:
            result = list_comments("issue-1", current_user={"tenant_id": "tenant-1"})
        self.assertEqual(result["comments"][0]["id"], "comment-1")
        mock_fetch_all.assert_called_once()

        with patch("app.routers.comments.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.comments.ensure_issue", return_value={"issue_key": "GRABBIT-1", "project_id": "project-1"}), patch("app.routers.comments.execute", return_value={"id": "comment-1"}) as mock_execute, patch("app.routers.comments.record_activity") as mock_record_activity, patch("app.routers.comments.event_bus.publish", new=async_noop):
            result = asyncio.run(add_comment("issue-1", CommentCreate(body="Looks good"), current_user={"id": "user-1"}))
        self.assertEqual(result["comment"]["id"], "comment-1")
        mock_execute.assert_called_once()
        mock_record_activity.assert_called_once()

    def test_reports_dashboard_and_sprint_report(self):
        with patch("app.routers.reports.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.reports.fetch_one", side_effect=[{"total_issues": 2, "done_issues": 1, "blocked_issues": 0, "high_priority_issues": 1, "overdue_issues": 0, "total_points": 5, "done_points": 3}, {"total_projects": 1}]), patch("app.routers.reports.fetch_all", return_value=[{"status": "DONE", "count": 1}]):
            result = dashboard(current_user={"tenant_id": "tenant-1"})
        self.assertEqual(result["summary"]["total_issues"], 2)

        with patch("app.routers.reports.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.reports.fetch_one", side_effect=[{"id": "sprint-1"}, {"total_issues": 2, "done_issues": 1, "blocked_issues": 0, "total_points": 5, "done_points": 3}]), patch("app.routers.reports.fetch_all", return_value=[{"status": "DONE", "count": 1}]):
            result = sprint_report("sprint-1", current_user={"tenant_id": "tenant-1"})
        self.assertEqual(result["sprint"]["id"], "sprint-1")

    def test_project_update_and_archive_permissions(self):
        with patch("app.routers.projects.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.projects.fetch_one", return_value={"id": "project-1", "tenant_id": "tenant-1", "name": "Grabbit", "description": "", "status": "ACTIVE", "visibility": "EVERYONE", "created_by": "user-1"}), patch("app.routers.projects.execute", return_value={"id": "project-1", "key": "GRABBIT"}), patch("app.routers.projects.record_activity"), patch("app.routers.projects.event_bus.publish", new=async_noop):
            result = asyncio.run(update_project("project-1", ProjectUpdate(name="Grabbit 2", visibility="PRIVATE"), current_user={"id": "user-1", "tenant_id": "tenant-1", "role": "MEMBER"}))
        self.assertEqual(result["project"]["id"], "project-1")

        with patch("app.routers.projects.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.projects.fetch_one", return_value={"id": "project-1", "tenant_id": "tenant-1", "name": "Grabbit", "description": "", "status": "ACTIVE", "visibility": "EVERYONE", "created_by": "user-2"}):
            with self.assertRaises(HTTPException):
                asyncio.run(archive_project("project-1", current_user={"id": "user-1", "tenant_id": "tenant-1", "role": "MEMBER"}))

        with patch("app.routers.projects.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.projects.fetch_one", return_value={"id": "project-1", "tenant_id": "tenant-1", "name": "Grabbit", "description": "", "status": "ACTIVE", "visibility": "EVERYONE", "created_by": "user-1"}), patch("app.routers.projects.execute", return_value={"id": "project-1", "key": "GRABBIT"}), patch("app.routers.projects.record_activity"), patch("app.routers.projects.event_bus.publish", new=async_noop):
            archived = asyncio.run(archive_project("project-1", current_user={"id": "user-1", "tenant_id": "tenant-1", "role": "OWNER"}))
        self.assertTrue(archived["ok"])

    def test_sprint_routes_cover_schedule_and_member_actions(self):
        with patch("app.routers.sprints.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.sprints.fetch_all", return_value=[{"id": "sprint-1"}]):
            result = list_sprints(current_user={"tenant_id": "tenant-1"})
        self.assertEqual(result["sprints"][0]["id"], "sprint-1")

        with patch("app.routers.sprints.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.sprints.ensure_project", return_value={"id": "project-1"}) as mock_project, patch("app.routers.sprints.execute", return_value={"id": "sprint-1", "project_id": "project-1", "name": "June 2026"}) as mock_execute, patch("app.routers.sprints.record_activity") as mock_record_activity, patch("app.routers.sprints.event_bus.publish", new=async_noop):
            result = asyncio.run(create_sprint(SprintCreate(project_id="project-1", name="June 2026"), current_user={"id": "user-1", "tenant_id": "tenant-1"}))
        self.assertIn("sprint", result)
        mock_project.assert_called_once_with("project-1", "tenant-1")
        mock_execute.assert_called_once()
        mock_record_activity.assert_called_once()

        sprint_row = {"id": "sprint-1", "project_id": "project-1", "name": "June 2026"}
        with patch("app.routers.sprints.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.sprints.fetch_one", side_effect=[sprint_row, None, sprint_row, sprint_row]), patch("app.routers.sprints.execute", side_effect=[{"id": "sprint-1", "project_id": "project-1", "name": "June 2026"}, None]), patch("app.routers.sprints.record_activity") as mock_record_activity, patch("app.routers.sprints.event_bus.publish", new=async_noop):
            result = asyncio.run(start_sprint("sprint-1", current_user={"id": "user-1", "tenant_id": "tenant-1", "role": "OWNER"}))
        self.assertEqual(result["sprint"]["id"], "sprint-1")

        with patch("app.routers.sprints.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.sprints.fetch_one", return_value={"id": "sprint-1", "project_id": "project-1", "name": "June 2026"}), patch("app.routers.sprints.get_conn") as mock_get_conn, patch("app.routers.sprints.record_activity") as mock_record_activity, patch("app.routers.sprints.event_bus.publish", new=async_noop):
            class Cursor:
                def __enter__(self): return self
                def __exit__(self, exc_type, exc, tb): return False
                def execute(self, query, params=()): pass
                def fetchone(self): return {"id": "sprint-1", "project_id": "project-1", "name": "June 2026"}
                def fetchall(self): return [{"id": "issue-1"}]
            class Conn:
                def cursor(self): return Cursor()
            class Manager:
                def __enter__(self): return Conn()
                def __exit__(self, exc_type, exc, tb): return False
            mock_get_conn.return_value = Manager()
            result = asyncio.run(complete_sprint("sprint-1", current_user={"id": "user-1", "tenant_id": "tenant-1", "role": "OWNER"}))
        self.assertEqual(result["sprint"]["id"], "sprint-1")

        with patch("app.routers.sprints.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.sprints.fetch_one", side_effect=[{"id": "sprint-1", "project_id": "project-1", "name": "June 2026"}, None]), patch("app.routers.sprints.execute", return_value={"id": "issue-1"}), patch("app.routers.sprints.record_activity") as mock_record_activity, patch("app.routers.sprints.event_bus.publish", new=async_noop):
            result = asyncio.run(add_issues_to_sprint("sprint-1", type("Payload", (), {"issue_ids": ["issue-1"]})(), current_user={"id": "user-1", "tenant_id": "tenant-1"}))
        self.assertEqual(result["issues"][0]["id"], "issue-1")

    def test_sprint_start_conflict_and_complete_keep_strategy(self):
        with patch("app.routers.sprints.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.sprints.fetch_one", side_effect=[{"id": "sprint-1", "project_id": "project-1", "name": "June 2026"}, {"id": "other-sprint"}]):
            with self.assertRaises(HTTPException):
                asyncio.run(start_sprint("sprint-1", current_user={"id": "user-1", "tenant_id": "tenant-1", "role": "OWNER"}))

        with patch("app.routers.sprints.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.sprints.fetch_one", return_value={"id": "sprint-1", "project_id": "project-1", "name": "June 2026"}), patch("app.routers.sprints.get_conn") as mock_get_conn, patch("app.routers.sprints.record_activity") as mock_record_activity, patch("app.routers.sprints.event_bus.publish", new=async_noop):
            class Cursor:
                def __enter__(self): return self
                def __exit__(self, exc_type, exc, tb): return False
                def execute(self, query, params=()): pass
                def fetchone(self): return {"id": "sprint-1", "project_id": "project-1", "name": "June 2026"}
                def fetchall(self): return []
            class Conn:
                def cursor(self): return Cursor()
            class Manager:
                def __enter__(self): return Conn()
                def __exit__(self, exc_type, exc, tb): return False
            mock_get_conn.return_value = Manager()
            result = asyncio.run(complete_sprint("sprint-1", current_user={"id": "user-1", "tenant_id": "tenant-1", "role": "OWNER"}))
        self.assertEqual(result["moved_incomplete_to_backlog"], 0)

    def test_create_project_and_membership_list(self):
        with patch("app.routers.projects.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.projects.get_conn") as mock_get_conn, patch("app.routers.projects.record_activity") as mock_record_activity, patch("app.routers.projects.event_bus.publish", new=async_noop):
            class Cursor:
                def __init__(self):
                    self.calls = 0
                def __enter__(self): return self
                def __exit__(self, exc_type, exc, tb): return False
                def execute(self, query, params=()):
                    self.calls += 1
                def fetchone(self):
                    if self.calls == 1:
                        return {"id": "project-1", "tenant_id": "tenant-1", "key": "GRABBIT", "name": "Grabbit", "visibility": "EVERYONE"}
                    return None
            class Conn:
                def cursor(self): return Cursor()
            class Manager:
                def __enter__(self): return Conn()
                def __exit__(self, exc_type, exc, tb): return False
            mock_get_conn.return_value = Manager()
            result = asyncio.run(create_project(ProjectCreate(name="Grabbit"), current_user={"id": "user-1", "tenant_id": "tenant-1", "role": "OWNER"}))
        self.assertEqual(result["project"]["id"], "project-1")

    def test_create_project_race_falls_back_to_existing_row(self):
        with patch("app.routers.projects.resolve_tenant_id", return_value="tenant-1"), patch("app.routers.projects.get_conn") as mock_get_conn, patch("app.routers.projects.record_activity"), patch("app.routers.projects.event_bus.publish", new=async_noop):
            class Cursor:
                def __init__(self):
                    self.calls = 0
                def __enter__(self): return self
                def __exit__(self, exc_type, exc, tb): return False
                def execute(self, query, params=()):
                    self.calls += 1
                def fetchone(self):
                    if self.calls == 1:
                        return None
                    if self.calls == 2:
                        return {"id": "project-1", "tenant_id": "tenant-1", "key": "GRABBIT", "name": "Grabbit", "visibility": "EVERYONE"}
                    return None
            class Conn:
                def cursor(self): return Cursor()
            class Manager:
                def __enter__(self): return Conn()
                def __exit__(self, exc_type, exc, tb): return False
            mock_get_conn.return_value = Manager()
            result = asyncio.run(create_project(ProjectCreate(name="Grabbit"), current_user={"id": "user-1", "tenant_id": "tenant-1", "role": "OWNER"}))
        self.assertEqual(result["project"]["id"], "project-1")
