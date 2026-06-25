from __future__ import annotations

from ..database import fetch_one

BASE_ISSUE_COLUMNS = """
    i.id, i.tenant_id, i.project_id, i.sprint_id, i.issue_key, i.title, i.description, i.issue_type, i.status, i.priority,
    i.assignee_id, i.reporter_id, i.story_points, i.due_date, i.labels, i.position, i.created_at, i.updated_at
"""

FULL_ISSUE_COLUMNS = """
    i.id, i.tenant_id, i.project_id, i.sprint_id, i.issue_key, i.title, i.description, i.issue_type, i.status, i.priority,
    i.ai_pickable, i.agent_status, i.claimed_by_agent, i.claim_expires_at, i.repository_id, i.github_repo, i.github_branch, i.github_pr_url,
    i.github_pr_number, i.github_pr_status, i.agent_summary, i.agent_test_notes, i.agent_blocker_reason,
    i.assignee_id, i.reporter_id, i.story_points, i.due_date, i.labels, i.position, i.created_at, i.updated_at
"""

FALLBACK_ISSUE_COLUMNS = """
    i.id, i.tenant_id, i.project_id, i.sprint_id, i.issue_key, i.title, i.description, i.issue_type, i.status, i.priority,
    NULL::BOOLEAN AS ai_pickable,
    NULL::TEXT AS agent_status,
    NULL::TEXT AS claimed_by_agent,
    NULL::TIMESTAMPTZ AS claim_expires_at,
    NULL::UUID AS repository_id,
    NULL::TEXT AS github_repo,
    NULL::TEXT AS github_branch,
    NULL::TEXT AS github_pr_url,
    NULL::INTEGER AS github_pr_number,
    NULL::TEXT AS github_pr_status,
    NULL::TEXT AS agent_summary,
    NULL::TEXT AS agent_test_notes,
    NULL::TEXT AS agent_blocker_reason,
    i.assignee_id, i.reporter_id, i.story_points, i.due_date, i.labels, i.position, i.created_at, i.updated_at
"""


def _select_issue(query: str, params: tuple):
    try:
        return fetch_one(query, params)
    except Exception as exc:
        message = str(exc).lower()
        if "column" in message and "does not exist" in message:
            return None
        raise


def fetch_issue_by_id(issue_id: str, tenant_id: str, *, with_related: bool = True):
    if with_related:
        issue = _select_issue(
            f"""
            SELECT {FULL_ISSUE_COLUMNS},
                   p.key AS project_key, p.name AS project_name,
                   pr.repo AS repository_name, pr.provider AS repository_provider, pr.default_branch AS repository_default_branch, pr.branch_prefix AS repository_branch_prefix,
                   au.name AS assignee_name, ru.name AS reporter_name, s.name AS sprint_name
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            LEFT JOIN project_repositories pr ON pr.id = i.repository_id
            LEFT JOIN users au ON au.id = i.assignee_id
            LEFT JOIN users ru ON ru.id = i.reporter_id
            LEFT JOIN sprints s ON s.id = i.sprint_id
            WHERE i.id = %s AND i.tenant_id = %s
            """,
            (issue_id, tenant_id),
        )
        if issue is not None:
            return issue
    issue = fetch_one(
        f"""
        SELECT {FALLBACK_ISSUE_COLUMNS},
               p.key AS project_key, p.name AS project_name,
               au.name AS assignee_name, ru.name AS reporter_name, s.name AS sprint_name
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        LEFT JOIN users au ON au.id = i.assignee_id
        LEFT JOIN users ru ON ru.id = i.reporter_id
        LEFT JOIN sprints s ON s.id = i.sprint_id
        WHERE i.id = %s AND i.tenant_id = %s
        """,
        (issue_id, tenant_id),
    )
    return issue


def fetch_issue_by_key(issue_key: str, tenant_id: str, *, with_related: bool = True):
    if with_related:
        issue = _select_issue(
            f"""
            SELECT {FULL_ISSUE_COLUMNS},
                   p.key AS project_key, p.name AS project_name,
                   pr.repo AS repository_name, pr.provider AS repository_provider, pr.default_branch AS repository_default_branch, pr.branch_prefix AS repository_branch_prefix,
                   au.name AS assignee_name, ru.name AS reporter_name, s.name AS sprint_name
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            LEFT JOIN project_repositories pr ON pr.id = i.repository_id
            LEFT JOIN users au ON au.id = i.assignee_id
            LEFT JOIN users ru ON ru.id = i.reporter_id
            LEFT JOIN sprints s ON s.id = i.sprint_id
            WHERE i.issue_key = %s AND i.tenant_id = %s
            """,
            (issue_key, tenant_id),
        )
        if issue is not None:
            return issue
    return fetch_one(
        f"""
        SELECT {FALLBACK_ISSUE_COLUMNS},
               p.key AS project_key, p.name AS project_name,
               au.name AS assignee_name, ru.name AS reporter_name, s.name AS sprint_name
        FROM issues i
        JOIN projects p ON p.id = i.project_id
        LEFT JOIN users au ON au.id = i.assignee_id
        LEFT JOIN users ru ON ru.id = i.reporter_id
        LEFT JOIN sprints s ON s.id = i.sprint_id
        WHERE i.issue_key = %s AND i.tenant_id = %s
        """,
        (issue_key, tenant_id),
    )
