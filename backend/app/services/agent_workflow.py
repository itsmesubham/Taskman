from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import re
from urllib.parse import urlparse
from fastapi import HTTPException
from ..database import execute, fetch_all, fetch_one, get_conn
from ..config import get_settings
from ..utils import row_to_json, rows_to_json, serialize

ISSUE_SELECT_COLUMNS = """
    i.id, i.tenant_id, i.project_id, i.sprint_id, i.issue_key, i.title, i.description, i.issue_type, i.status, i.priority,
    i.ai_pickable, i.agent_status, i.claimed_by_agent, i.claim_expires_at, i.repository_id, i.github_repo, i.github_branch, i.github_pr_url,
    i.github_pr_number, i.github_pr_status, i.agent_summary, i.agent_test_notes, i.agent_blocker_reason,
    i.assignee_id, i.reporter_id, i.story_points, i.due_date, i.labels, i.position, i.created_at, i.updated_at
"""

ISSUE_DETAIL_SELECT = f"""
    SELECT {ISSUE_SELECT_COLUMNS},
           p.key AS project_key, p.name AS project_name,
           pr.repo AS repository_name, pr.provider AS repository_provider, pr.default_branch AS repository_default_branch, pr.branch_prefix AS repository_branch_prefix,
           au.name AS assignee_name, ru.name AS reporter_name, s.name AS sprint_name
    FROM issues i
    JOIN projects p ON p.id = i.project_id
    LEFT JOIN project_repositories pr ON pr.id = i.repository_id
    LEFT JOIN users au ON au.id = i.assignee_id
    LEFT JOIN users ru ON ru.id = i.reporter_id
    LEFT JOIN sprints s ON s.id = i.sprint_id
"""

VALID_AGENT_STATUSES = {"AVAILABLE", "CLAIMED", "WORKING", "SUBMITTED", "FAILED", "RELEASED"}
SAFE_TASK_STATUSES = {"BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "CHANGES_REQUESTED", "DONE", "BLOCKED"}
REPO_PATTERN = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


@dataclass
class AgentContext:
    tenant_id: str
    token_id: str
    name: str
    allowed_repo: str | None = None


def ensure_safe_repo(repo: str | None) -> str | None:
    if repo is None:
        return None
    value = repo.strip()
    if not value:
        return None
    if not REPO_PATTERN.match(value):
        raise HTTPException(status_code=400, detail="Invalid GitHub repo format")
    return value


def sanitize_pr_url(pr_url: str) -> str:
    parsed = urlparse(pr_url.strip())
    if parsed.scheme not in {"https", "http"}:
        raise HTTPException(status_code=400, detail="Invalid PR URL")
    if parsed.netloc.lower() != "github.com":
        raise HTTPException(status_code=400, detail="PR URL must point to github.com")
    if "/pull/" not in parsed.path:
        raise HTTPException(status_code=400, detail="PR URL must reference a pull request")
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")


def extract_pr_number(pr_url: str | None, pr_number: int | None = None) -> int | None:
    if pr_number is not None:
        return int(pr_number)
    if not pr_url:
        return None
    match = re.search(r"/pull/(\d+)", pr_url)
    if not match:
        return None
    return int(match.group(1))


def issue_row(issue_id: str, tenant_id: str):
    issue = fetch_one(
        f"{ISSUE_DETAIL_SELECT} WHERE i.id = %s AND i.tenant_id = %s",
        (issue_id, tenant_id),
    )
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


def issue_list_rows(tenant_id: str, where: list[str] | None = None, params: list | None = None):
    clauses = ["i.tenant_id = %s"]
    query_params: list = [tenant_id]
    if where:
        clauses.extend(where)
    if params:
        query_params.extend(params)
    rows = fetch_all(
        f"""
        {ISSUE_DETAIL_SELECT}
        WHERE {' AND '.join(clauses)}
        ORDER BY i.position ASC, i.created_at DESC
        """,
        tuple(query_params),
    )
    return rows


def project_repository_row(repo_id: str, tenant_id: str, project_id: str | None = None):
    params: list = [tenant_id, repo_id]
    where = ["pr.tenant_id = %s", "pr.id = %s"]
    if project_id:
        where.append("pr.project_id = %s")
        params.append(project_id)
    row = fetch_one(
        f"""
        SELECT pr.id, pr.tenant_id, pr.project_id, pr.provider, pr.repo, pr.default_branch, pr.branch_prefix, pr.is_default, pr.status, pr.created_by, pr.created_at, pr.updated_at,
               p.key AS project_key, p.name AS project_name
        FROM project_repositories pr
        JOIN projects p ON p.id = pr.project_id
        WHERE {' AND '.join(where)}
        """,
        tuple(params),
    )
    return row


def project_repositories_for_project(tenant_id: str, project_id: str):
    rows = fetch_all(
        """
        SELECT pr.id, pr.tenant_id, pr.project_id, pr.provider, pr.repo, pr.default_branch, pr.branch_prefix, pr.is_default, pr.status, pr.created_by, pr.created_at, pr.updated_at,
               p.key AS project_key, p.name AS project_name
        FROM project_repositories pr
        JOIN projects p ON p.id = pr.project_id
        WHERE pr.tenant_id = %s AND pr.project_id = %s
        ORDER BY pr.is_default DESC, pr.created_at ASC
        """,
        (tenant_id, project_id),
    )
    return rows_to_json(rows)


def project_repositories_for_tenant(tenant_id: str):
    rows = fetch_all(
        """
        SELECT pr.id, pr.tenant_id, pr.project_id, pr.provider, pr.repo, pr.default_branch, pr.branch_prefix, pr.is_default, pr.status, pr.created_by, pr.created_at, pr.updated_at,
               p.key AS project_key, p.name AS project_name
        FROM project_repositories pr
        JOIN projects p ON p.id = pr.project_id
        WHERE pr.tenant_id = %s
        ORDER BY p.name ASC, pr.is_default DESC, pr.created_at ASC
        """,
        (tenant_id,),
    )
    return rows_to_json(rows)


def agent_repo_access_rows(tenant_id: str, agent_token_id: str):
    rows = fetch_all(
        """
        SELECT ara.id, ara.tenant_id, ara.agent_id, ara.project_id, ara.project_repository_id, ara.provider, ara.repo, ara.default_branch, ara.branch_prefix, ara.created_at,
               p.key AS project_key, p.name AS project_name,
               pr.is_default, pr.status, pr.created_at AS repository_created_at
        FROM agent_repo_access ara
        JOIN projects p ON p.id = ara.project_id
        JOIN project_repositories pr ON pr.id = ara.project_repository_id
        WHERE ara.tenant_id = %s AND ara.agent_id = %s
        ORDER BY p.name ASC, pr.is_default DESC, pr.created_at ASC
        """,
        (tenant_id, agent_token_id),
    )
    return rows_to_json(rows)


def allowed_repo_set_for_agent(tenant_id: str, agent: AgentContext):
    try:
        rows = fetch_all(
            """
            SELECT repo, project_id, project_repository_id
            FROM agent_repo_access
            WHERE tenant_id = %s AND agent_id = %s
            """,
            (tenant_id, agent.token_id),
        )
    except Exception:
        rows = []
    allowed_repo_ids = {str(row["project_repository_id"]) for row in rows}
    allowed_repo_names = {str(row["repo"]).strip() for row in rows}
    allowed_project_ids = {str(row["project_id"]) for row in rows}
    if agent.allowed_repo:
        allowed_repo_names.add(agent.allowed_repo)
    return {
        "repo_ids": allowed_repo_ids,
        "repos": allowed_repo_names,
        "project_ids": allowed_project_ids,
    }


def project_repo_scope_for_task(issue: dict, tenant_id: str):
    repo_id = issue.get("repository_id")
    if repo_id:
        row = project_repository_row(str(repo_id), tenant_id, str(issue["project_id"]))
        if row:
            return row_to_json(row)
    repo_value = ensure_safe_repo(issue.get("github_repo"))
    if not repo_value:
        return None
    row = fetch_one(
        """
        SELECT pr.id, pr.tenant_id, pr.project_id, pr.provider, pr.repo, pr.default_branch, pr.branch_prefix, pr.is_default, pr.status, pr.created_by, pr.created_at, pr.updated_at,
               p.key AS project_key, p.name AS project_name
        FROM project_repositories pr
        JOIN projects p ON p.id = pr.project_id
        WHERE pr.tenant_id = %s AND pr.project_id = %s AND pr.repo = %s
        LIMIT 1
        """,
        (tenant_id, issue["project_id"], repo_value),
    )
    return row_to_json(row) if row else None


def issue_repo_access_ok(issue: dict, agent: AgentContext):
    scope = allowed_repo_set_for_agent(issue["tenant_id"], agent)
    if not scope["repo_ids"] and not scope["repos"]:
        return False
    if issue.get("project_id") and scope["project_ids"] and str(issue["project_id"]) not in scope["project_ids"]:
        return False
    if issue.get("repository_id"):
        if str(issue["repository_id"]) in scope["repo_ids"]:
            return True
        repo_value = ensure_safe_repo(issue.get("github_repo"))
        if repo_value and repo_value in scope["repos"]:
            return True
        return False
    repo_value = ensure_safe_repo(issue.get("github_repo"))
    if repo_value:
        return repo_value in scope["repos"]
    if issue.get("ai_pickable"):
        return False
    return True


def resolve_issue_repository(issue: dict, tenant_id: str, project_id: str, repository_id: str | None = None, github_repo: str | None = None):
    repo_id = repository_id or issue.get("repository_id")
    if repo_id:
        row = project_repository_row(str(repo_id), tenant_id, project_id)
        if not row:
            raise HTTPException(status_code=400, detail="Repository does not belong to the selected project")
        return row_to_json(row)
    repo_value = ensure_safe_repo(github_repo or issue.get("github_repo"))
    if repo_value:
        row = fetch_one(
            """
            SELECT pr.id, pr.tenant_id, pr.project_id, pr.provider, pr.repo, pr.default_branch, pr.branch_prefix, pr.is_default, pr.status, pr.created_by, pr.created_at, pr.updated_at,
                   p.key AS project_key, p.name AS project_name
            FROM project_repositories pr
            JOIN projects p ON p.id = pr.project_id
            WHERE pr.tenant_id = %s AND pr.project_id = %s AND pr.repo = %s
            LIMIT 1
            """,
            (tenant_id, project_id, repo_value),
        )
        if row:
            return row_to_json(row)
    if issue.get("ai_pickable") or github_repo is not None or repository_id is not None:
        raise HTTPException(status_code=400, detail="Task repository must be selected before making it AI-pickable")
    return None


def _release_expired_claim_row(issue: dict, released_reason: str = "expired"):
    if not issue.get("claim_expires_at"):
        return issue
    expiry = issue["claim_expires_at"]
    if getattr(expiry, "tzinfo", None) is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry > datetime.now(timezone.utc):
        return issue
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE issues
                SET claimed_by_agent = NULL,
                    claim_expires_at = NULL,
                    agent_status = 'AVAILABLE',
                    updated_at = now()
                WHERE id = %s AND tenant_id = %s
                RETURNING *
                """,
                (issue["id"], issue["tenant_id"]),
            )
            refreshed = cur.fetchone()
            cur.execute(
                """
                UPDATE agent_claims
                SET released_at = now(),
                    release_reason = %s,
                    updated_at = now()
                WHERE issue_id = %s AND tenant_id = %s AND released_at IS NULL
                """,
                (released_reason, issue["id"], issue["tenant_id"]),
            )
    return refreshed or issue


def normalize_issue_row(issue: dict):
    normalized = issue
    if issue.get("claim_expires_at") and issue.get("agent_status") in {"CLAIMED", "WORKING", "SUBMITTED", "FAILED"}:
        normalized = _release_expired_claim_row(issue)
    return row_to_json(normalized)


def record_automation_event(
    tenant_id: str,
    issue_id: str | None,
    actor_kind: str,
    message: str,
    *,
    actor_name: str | None = None,
    event_type: str = "agent_event",
    metadata: dict | None = None,
):
    return execute(
        """
        INSERT INTO automation_events (tenant_id, issue_id, actor_kind, actor_name, event_type, message, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
        RETURNING *
        """,
        (tenant_id, issue_id, actor_kind, actor_name, event_type, message, json.dumps(serialize(metadata or {}))),
    )


def record_external_link(
    tenant_id: str,
    issue_id: str,
    link_type: str,
    url: str,
    *,
    title: str = "",
    metadata: dict | None = None,
):
    return execute(
        """
        INSERT INTO external_links (tenant_id, issue_id, link_type, url, title, metadata)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb)
        RETURNING *
        """,
        (tenant_id, issue_id, link_type, url, title, json.dumps(serialize(metadata or {}))),
    )


def current_task_comments(issue_id: str, tenant_id: str):
    rows = fetch_all(
        """
        SELECT a.*
        FROM automation_events a
        WHERE a.issue_id = %s AND a.tenant_id = %s
          AND a.event_type IN ('agent_comment', 'claim_task', 'release_task', 'attach_pull_request', 'submit_work_for_review', 'task_blocked', 'github_pull_request', 'github_review', 'github_check')
        ORDER BY a.created_at ASC
        """,
        (issue_id, tenant_id),
    )
    return rows_to_json(rows)


def current_task_links(issue_id: str, tenant_id: str):
    rows = fetch_all(
        """
        SELECT *
        FROM external_links
        WHERE issue_id = %s AND tenant_id = %s
        ORDER BY created_at DESC
        """,
        (issue_id, tenant_id),
    )
    return rows_to_json(rows)


def issue_activity_timeline(issue_id: str, tenant_id: str):
    rows = fetch_all(
        """
        SELECT *
        FROM automation_events
        WHERE issue_id = %s AND tenant_id = %s
        ORDER BY created_at ASC
        """,
        (issue_id, tenant_id),
    )
    return rows_to_json(rows)


def _update_issue_and_claim(
    issue_id: str,
    tenant_id: str,
    *,
    set_sql: str,
    params: tuple,
):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE issues
                SET {set_sql}, updated_at = now()
                WHERE id = %s AND tenant_id = %s
                RETURNING *
                """,
                params + (issue_id, tenant_id),
            )
            return cur.fetchone()


def claim_task(issue_id: str, tenant_id: str, agent: AgentContext, claim_minutes: int):
    issue = issue_row(issue_id, tenant_id)
    if not issue.get("ai_pickable"):
        raise HTTPException(status_code=400, detail="Task is not AI-pickable")
    if not issue_repo_access_ok(issue, agent):
        raise HTTPException(status_code=403, detail="Repository is not allowed for this task or agent")
    repo_row = project_repo_scope_for_task(issue, tenant_id)
    if not repo_row:
        raise HTTPException(status_code=409, detail="Task repository must be selected before an agent can claim it")
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=claim_minutes)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE issues
                SET claimed_by_agent = %s,
                    claim_expires_at = %s,
                    agent_status = 'CLAIMED',
                    repository_id = COALESCE(%s, repository_id),
                    github_repo = COALESCE(%s, github_repo),
                    status = CASE WHEN status = 'BACKLOG' THEN 'TODO' ELSE status END,
                    updated_at = now()
                WHERE id = %s
                  AND tenant_id = %s
                  AND ai_pickable = true
                  AND (
                        claimed_by_agent IS NULL
                        OR claim_expires_at < now()
                        OR agent_status IN ('AVAILABLE', 'RELEASED', 'FAILED')
                  )
                RETURNING *
                """,
                (agent.name, expires_at, repo_row["id"] if repo_row else None, repo_row["repo"] if repo_row else None, issue_id, tenant_id),
            )
            issue = cur.fetchone()
            if not issue:
                raise HTTPException(status_code=409, detail="Task is already claimed or not AI-pickable")
            cur.execute(
                """
                INSERT INTO agent_claims (tenant_id, issue_id, agent_token_id, claimed_by_agent, claim_expires_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (issue_id)
                DO UPDATE SET
                    agent_token_id = EXCLUDED.agent_token_id,
                    claimed_by_agent = EXCLUDED.claimed_by_agent,
                    claim_expires_at = EXCLUDED.claim_expires_at,
                    released_at = NULL,
                    release_reason = NULL,
                    updated_at = now()
                RETURNING *
                """,
                (tenant_id, issue_id, agent.token_id, agent.name, expires_at),
            )
            claim = cur.fetchone()
    record_automation_event(tenant_id, issue_id, "agent", f"{agent.name} claimed {issue['issue_key']}", actor_name=agent.name, event_type="claim_task", metadata={"expires_at": expires_at.isoformat()})
    return issue, claim


def release_task(issue_id: str, tenant_id: str, agent: AgentContext, *, back_to_todo: bool = True, reason: str = "released"):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM issues WHERE id = %s AND tenant_id = %s",
                (issue_id, tenant_id),
            )
            issue = cur.fetchone()
            if not issue:
                raise HTTPException(status_code=404, detail="Issue not found")
            if issue.get("claimed_by_agent") != agent.name:
                raise HTTPException(status_code=403, detail="Task is not claimed by this agent")
            cur.execute(
                """
                UPDATE issues
                SET claimed_by_agent = NULL,
                    claim_expires_at = NULL,
                    agent_status = 'RELEASED',
                    status = CASE WHEN %s THEN 'TODO' ELSE status END,
                    updated_at = now()
                WHERE id = %s AND tenant_id = %s
                RETURNING *
                """,
                (back_to_todo, issue_id, tenant_id),
            )
            updated = cur.fetchone()
            cur.execute(
                """
                UPDATE agent_claims
                SET released_at = now(),
                    release_reason = %s,
                    updated_at = now()
                WHERE issue_id = %s AND tenant_id = %s
                RETURNING *
                """,
                (reason, issue_id, tenant_id),
            )
    record_automation_event(tenant_id, issue_id, "agent", f"{agent.name} released {issue['issue_key']}", actor_name=agent.name, event_type="release_task", metadata={"reason": reason})
    return updated


def set_task_blocked(issue_id: str, tenant_id: str, agent: AgentContext, reason: str):
    issue = issue_row(issue_id, tenant_id)
    if issue.get("claimed_by_agent") != agent.name:
        raise HTTPException(status_code=403, detail="Task is not claimed by this agent")
    updated = execute(
        """
        UPDATE issues
        SET status = 'BLOCKED',
            agent_status = 'FAILED',
            agent_blocker_reason = %s,
            updated_at = now()
        WHERE id = %s AND tenant_id = %s
        RETURNING *
        """,
        (reason, issue_id, tenant_id),
    )
    record_automation_event(tenant_id, issue_id, "agent", f"{agent.name} blocked {issue['issue_key']}: {reason}", actor_name=agent.name, event_type="task_blocked", metadata={"reason": reason})
    return updated


def safe_transition_status(current_status: str, next_status: str):
    if next_status not in SAFE_TASK_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    allowed = {
        "BACKLOG": {"TODO", "BLOCKED"},
        "TODO": {"IN_PROGRESS", "BLOCKED"},
        "IN_PROGRESS": {"IN_REVIEW", "BLOCKED", "CHANGES_REQUESTED"},
        "IN_REVIEW": {"CHANGES_REQUESTED", "BLOCKED", "DONE"},
        "CHANGES_REQUESTED": {"IN_PROGRESS", "BLOCKED", "IN_REVIEW"},
        "BLOCKED": {"TODO", "IN_PROGRESS"},
        "DONE": set(),
    }
    if next_status == current_status:
        return
    if next_status not in allowed.get(current_status, set()):
        raise HTTPException(status_code=400, detail="Status transition not allowed")


def attach_pull_request(
    issue_id: str,
    tenant_id: str,
    agent: AgentContext,
    *,
    repo: str,
    branch: str,
    pr_url: str,
    pr_number: int | None,
    summary: str,
    test_notes: str,
    changed_files: list[str],
):
    issue = issue_row(issue_id, tenant_id)
    if issue.get("claimed_by_agent") != agent.name:
        raise HTTPException(status_code=403, detail="Task is not claimed by this agent")
    repo_value = ensure_safe_repo(repo)
    if not repo_value:
        raise HTTPException(status_code=400, detail="Repo is required")
    if not issue_repo_access_ok({**issue, "github_repo": repo_value}, agent):
        raise HTTPException(status_code=403, detail="Repository is not allowed for this task or agent")
    resolved_repo = resolve_issue_repository(issue, tenant_id, issue["project_id"], github_repo=repo_value)
    if issue.get("repository_id") and resolved_repo and str(resolved_repo["id"]) != str(issue["repository_id"]):
        raise HTTPException(status_code=400, detail="Pull request repo does not match task repo")
    pr_url_value = sanitize_pr_url(pr_url)
    pr_number_value = extract_pr_number(pr_url_value, pr_number)
    if pr_number_value is None:
        raise HTTPException(status_code=400, detail="PR number is required")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE issues
                SET github_repo = %s,
                    github_branch = %s,
                    github_pr_url = %s,
                    github_pr_number = %s,
                    github_pr_status = 'OPEN',
                    agent_summary = %s,
                    agent_test_notes = %s,
                    agent_status = 'SUBMITTED',
                    status = 'IN_REVIEW',
                    repository_id = COALESCE(%s, repository_id),
                    updated_at = now()
                WHERE id = %s AND tenant_id = %s
                RETURNING *
                """,
                (
                    repo_value,
                    branch.strip(),
                    pr_url_value,
                    pr_number_value,
                    summary.strip(),
                    test_notes.strip(),
                    str(resolved_repo["id"]) if resolved_repo else None,
                    issue_id,
                    tenant_id,
                ),
            )
            updated = cur.fetchone()
            cur.execute(
                """
                INSERT INTO agent_claims (tenant_id, issue_id, agent_token_id, claimed_by_agent, claim_expires_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (issue_id)
                DO UPDATE SET
                    agent_token_id = EXCLUDED.agent_token_id,
                    claimed_by_agent = EXCLUDED.claimed_by_agent,
                    claim_expires_at = EXCLUDED.claim_expires_at,
                    released_at = NULL,
                    release_reason = NULL,
                    updated_at = now()
                """,
                (tenant_id, issue_id, agent.token_id, agent.name, datetime.now(timezone.utc) + timedelta(minutes=get_settings().agent_claim_minutes)),
            )
            record_external_link(
                tenant_id,
                issue_id,
                "pull_request",
                pr_url_value,
                title=f"PR #{pr_number_value}",
                metadata={"repo": repo_value, "branch": branch, "summary": summary, "test_notes": test_notes, "changed_files": changed_files, "pr_number": pr_number_value},
            )
    record_automation_event(
        tenant_id,
        issue_id,
        "agent",
        f"{agent.name} attached PR #{pr_number_value} for {updated['issue_key']}",
        actor_name=agent.name,
        event_type="attach_pull_request",
        metadata={"repo": repo_value, "branch": branch, "pr_url": pr_url_value, "pr_number": pr_number_value, "changed_files": changed_files},
    )
    return updated


def submit_work_for_review(
    issue_id: str,
    tenant_id: str,
    agent: AgentContext,
    *,
    repo: str,
    branch: str,
    pr_url: str,
    pr_number: int | None,
    summary: str,
    test_notes: str,
    changed_files: list[str],
):
    updated = attach_pull_request(
        issue_id,
        tenant_id,
        agent,
        repo=repo,
        branch=branch,
        pr_url=pr_url,
        pr_number=pr_number,
        summary=summary,
        test_notes=test_notes,
        changed_files=changed_files,
    )
    record_automation_event(tenant_id, issue_id, "agent", f"{agent.name} submitted {updated['issue_key']} for review", actor_name=agent.name, event_type="submit_work_for_review", metadata={"pr_url": updated.get("github_pr_url")})
    return updated


def update_task_status(issue_id: str, tenant_id: str, agent: AgentContext, next_status: str, note: str | None = None):
    issue = issue_row(issue_id, tenant_id)
    if issue.get("claimed_by_agent") != agent.name:
        raise HTTPException(status_code=403, detail="Task is not claimed by this agent")
    safe_transition_status(issue["status"], next_status)
    if next_status == "DONE":
        raise HTTPException(status_code=400, detail="Agents cannot mark tasks done directly")
    updated = execute(
        """
        UPDATE issues
        SET status = %s,
            agent_status = CASE WHEN %s = 'IN_PROGRESS' THEN 'WORKING' WHEN %s = 'IN_REVIEW' THEN 'SUBMITTED' WHEN %s = 'BLOCKED' THEN 'FAILED' ELSE agent_status END,
            agent_blocker_reason = CASE WHEN %s IS NOT NULL THEN %s ELSE agent_blocker_reason END,
            updated_at = now()
        WHERE id = %s AND tenant_id = %s
        RETURNING *
        """,
        (next_status, next_status, next_status, next_status, note, note, issue_id, tenant_id),
    )
    record_automation_event(tenant_id, issue_id, "agent", f"{agent.name} moved {issue['issue_key']} to {next_status}", actor_name=agent.name, event_type="status_update", metadata={"from": issue["status"], "to": next_status, "note": note})
    return updated


def verify_github_signature(secret: str, body: bytes, signature_header: str | None):
    if not secret:
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header.removeprefix("sha256="))


def find_issue_by_pr(repo: str, pr_number: int | None = None, pr_url: str | None = None, tenant_id: str | None = None):
    params: list = [repo]
    where = ["el.link_type = 'pull_request'", "(el.metadata->>'repo') = %s"]
    if tenant_id:
        where.insert(0, "el.tenant_id = %s")
        params.insert(0, tenant_id)
    if pr_number is not None:
        where.append("(el.metadata->>'pr_number')::int = %s")
        params.append(pr_number)
    elif pr_url:
        where.append("el.url = %s")
        params.append(pr_url)
    row = fetch_one(
        f"""
        SELECT {ISSUE_SELECT_COLUMNS},
               p.key AS project_key, p.name AS project_name,
               au.name AS assignee_name, ru.name AS reporter_name, s.name AS sprint_name
        FROM external_links el
        JOIN issues i ON i.id = el.issue_id
        JOIN projects p ON p.id = i.project_id
        LEFT JOIN users au ON au.id = i.assignee_id
        LEFT JOIN users ru ON ru.id = i.reporter_id
        LEFT JOIN sprints s ON s.id = i.sprint_id
        WHERE {' AND '.join(where)}
        ORDER BY el.created_at DESC
        LIMIT 1
        """,
        tuple(params),
    )
    if row:
        return row
    params = [repo]
    where = ["i.github_repo = %s"]
    if tenant_id:
        where.insert(0, "i.tenant_id = %s")
        params.insert(0, tenant_id)
    if pr_number is not None:
        where.append("i.github_pr_number = %s")
        params.append(pr_number)
    elif pr_url:
        where.append("i.github_pr_url = %s")
        params.append(pr_url)
    return fetch_one(
        f"""
        {ISSUE_DETAIL_SELECT}
        WHERE {' AND '.join(where)}
        ORDER BY i.updated_at DESC
        LIMIT 1
        """,
        tuple(params),
    )
