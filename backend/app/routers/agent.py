from __future__ import annotations

import time
from collections import deque
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from ..config import get_settings
from ..database import execute, fetch_all, fetch_one, get_conn
from ..security import generate_agent_token, get_current_agent, get_current_user, hash_agent_token
from ..services.activity import record_activity
from ..services.agent_workflow import (
    AgentContext,
    agent_repo_access_rows,
    allowed_repo_set_for_agent,
    attach_pull_request as attach_pull_request_workflow,
    claim_task as claim_task_workflow,
    current_task_links,
    current_task_comments,
    ensure_safe_repo,
    find_issue_by_pr,
    issue_activity_timeline,
    issue_list_rows,
    issue_row,
    issue_repo_access_ok,
    normalize_issue_row,
    record_automation_event,
    release_task as release_task_workflow,
    safe_transition_status,
    set_task_blocked,
    submit_work_for_review as submit_work_for_review_workflow,
    update_task_status as update_task_status_workflow,
    verify_github_signature,
)
from ..utils import row_to_json, rows_to_json, serialize

router = APIRouter(prefix="/api/agent", tags=["agent"])
webhook_router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])

RATE_LIMIT_BUCKETS: dict[str, deque[float]] = {}


class AgentTokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    allowed_repo: str | None = Field(default=None, max_length=200)
    project_repository_ids: list[str] = Field(default_factory=list)


class TaskListQuery(BaseModel):
    repo: str | None = None
    priority: str | None = None
    labels: list[str] = Field(default_factory=list)
    max_results: int = 20


class ClaimRequest(BaseModel):
    claim_minutes: int | None = Field(default=None, ge=5, le=240)


class CommentRequest(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class StatusRequest(BaseModel):
    status: str = Field(min_length=1, max_length=32)
    note: str | None = Field(default=None, max_length=5000)


class PullRequestRequest(BaseModel):
    task_id: str
    repo: str
    branch: str
    pr_url: str
    pr_number: int | None = Field(default=None, ge=1)
    summary: str = Field(default="")
    test_notes: str = Field(default="")
    changed_files: list[str] = Field(default_factory=list)


class SubmitReviewRequest(PullRequestRequest):
    pass


class ReleaseRequest(BaseModel):
    return_to_todo: bool = True
    reason: str = Field(default="released", max_length=500)


class BlockedRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


def resolve_tenant_id(current_user: dict) -> str:
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Workspace not selected")
    return str(tenant_id)


def require_agent_rate_limit(current_agent: dict = Depends(get_current_agent)):
    settings = get_settings()
    now = time.time()
    bucket = RATE_LIMIT_BUCKETS.setdefault(current_agent["id"], deque())
    while bucket and now - bucket[0] > 60:
        bucket.popleft()
    if len(bucket) >= settings.agent_rate_limit_per_minute:
        raise HTTPException(status_code=429, detail="Agent rate limit exceeded")
    bucket.append(now)
    return current_agent


def agent_context(current_agent: dict) -> AgentContext:
    return AgentContext(
        tenant_id=str(current_agent["tenant_id"]),
        token_id=str(current_agent["id"]),
        name=str(current_agent["name"]),
        allowed_repo=current_agent.get("allowed_repo"),
    )


def build_agent_project_tree(tenant_id: str, agent_token_id: str):
    rows = agent_repo_access_rows(tenant_id, agent_token_id)
    projects: dict[str, dict] = {}
    for row in rows:
        project_id = str(row["project_id"])
        project = projects.setdefault(
            project_id,
            {
                "id": project_id,
                "name": row.get("project_name"),
                "key": row.get("project_key"),
                "repositories": [],
            },
        )
        project["repositories"].append(
            {
                "id": str(row["project_repository_id"]),
                "provider": row["provider"],
                "repo": row["repo"],
                "default_branch": row["default_branch"],
                "branch_prefix": row["branch_prefix"],
                "is_default": row.get("is_default", False),
                "status": row.get("status", "ACTIVE"),
            }
        )
    return list(projects.values())


def workspace_slug_for_tenant(tenant_id: str) -> str | None:
    try:
        row = fetch_one("SELECT slug FROM tenants WHERE id = %s", (tenant_id,))
    except Exception:
        return None
    return row["slug"] if row and row.get("slug") else None


def task_url_for_issue(tenant_id: str, issue: dict) -> str:
    slug = workspace_slug_for_tenant(tenant_id)
    issue_key = issue.get("issue_key")
    if slug and issue_key:
        return f"/workspaces/{slug}/tasks/{issue_key}"
    if issue_key:
      return f"/tasks/{issue_key}"
    return "/"


def task_response(issue: dict, tenant_id: str):
    task = normalize_issue_row(issue)
    task_key = task.get("issue_key")
    task_url = task_url_for_issue(tenant_id, task)
    return {
        "task": {**task, "task_key": task_key, "task_url": task_url},
        "task_key": task_key,
        "task_url": task_url,
    }


def token_repo_access_rows(tenant_id: str, token_id: str):
    rows = fetch_all(
        """
        SELECT ara.id, ara.tenant_id, ara.agent_id, ara.project_id, ara.project_repository_id, ara.provider, ara.repo, ara.default_branch, ara.branch_prefix, ara.created_at,
               p.key AS project_key, p.name AS project_name
        FROM agent_repo_access ara
        JOIN projects p ON p.id = ara.project_id
        WHERE ara.tenant_id = %s AND ara.agent_id = %s
        ORDER BY ara.created_at ASC
        """,
        (tenant_id, token_id),
    )
    return rows_to_json(rows)


def validate_agent_task(issue: dict, agent: AgentContext):
    if str(issue["tenant_id"]) != agent.tenant_id:
        raise HTTPException(status_code=403, detail="Task is outside this agent tenant")
    if issue.get("claimed_by_agent") and issue.get("claimed_by_agent") != agent.name:
        raise HTTPException(status_code=403, detail="Task is claimed by another agent")
    if not issue_repo_access_ok(issue, agent):
        raise HTTPException(status_code=403, detail="Task repo is not allowed for this agent")


@router.get("/tools")
def list_tools(current_agent: dict = Depends(require_agent_rate_limit)):
    return {
        "tools": [
            {"name": "get_agent_context", "path": "/api/agent/context", "method": "GET"},
            {"name": "list_available_tasks", "path": "/api/agent/tasks/available", "method": "GET"},
            {"name": "get_task_details", "path": "/api/agent/tasks/{id}", "method": "GET"},
            {"name": "claim_task", "path": "/api/agent/tasks/{id}/claim", "method": "POST"},
            {"name": "add_task_comment", "path": "/api/agent/tasks/{id}/comment", "method": "POST"},
            {"name": "update_task_status", "path": "/api/agent/tasks/{id}/status", "method": "POST"},
            {"name": "attach_pull_request", "path": "/api/agent/tasks/{id}/pull-request", "method": "POST"},
            {"name": "submit_work_for_review", "path": "/api/agent/tasks/{id}/submit-review", "method": "POST"},
            {"name": "release_task", "path": "/api/agent/tasks/{id}/release", "method": "POST"},
            {"name": "mark_task_blocked", "path": "/api/agent/tasks/{id}/blocked", "method": "POST"},
        ]
    }


@router.get("/tokens")
def list_agent_tokens(current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    if current_user["role"] not in ("OWNER", "ADMIN"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    rows = fetch_all(
        """
        SELECT id, tenant_id, name, allowed_repo, scopes, active, created_by, last_used_at, created_at
        FROM agent_tokens
        WHERE tenant_id = %s
        ORDER BY created_at DESC
        """,
        (tenant_id,),
    )
    tokens = rows_to_json(rows)
    for token in tokens:
        token["repository_access"] = token_repo_access_rows(tenant_id, token["id"])
    return {"tokens": tokens}


@router.post("/tokens")
def create_agent_token(payload: AgentTokenCreate, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    if current_user["role"] not in ("OWNER", "ADMIN"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    raw_token = generate_agent_token()
    token_hash = hash_agent_token(raw_token)
    allowed_repo = ensure_safe_repo(payload.allowed_repo)
    token = execute(
        """
        INSERT INTO agent_tokens (tenant_id, name, token_hash, allowed_repo, created_by)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id, tenant_id, name, allowed_repo, scopes, active, created_by, last_used_at, created_at
        """,
        (tenant_id, payload.name.strip(), token_hash, allowed_repo, current_user["id"]),
    )
    if payload.project_repository_ids:
        repo_rows = fetch_all(
            """
            SELECT pr.id, pr.tenant_id, pr.project_id, pr.provider, pr.repo, pr.default_branch, pr.branch_prefix, pr.status
            FROM project_repositories pr
            JOIN projects p ON p.id = pr.project_id
            WHERE pr.tenant_id = %s AND pr.id = ANY(%s)
              AND p.tenant_id = %s
            """,
            (tenant_id, payload.project_repository_ids, tenant_id),
        )
        if len(repo_rows) != len(set(payload.project_repository_ids)):
            raise HTTPException(status_code=400, detail="One or more repository selections are invalid")
        repo_rows_by_id = {str(row["id"]): row for row in repo_rows}
        with get_conn() as conn:
            with conn.cursor() as cur:
                for repo_id in payload.project_repository_ids:
                    repo_row = repo_rows_by_id[str(repo_id)]
                    cur.execute(
                        """
                        INSERT INTO agent_repo_access (tenant_id, agent_id, project_id, project_repository_id, provider, repo, default_branch, branch_prefix)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (agent_id, project_repository_id)
                        DO UPDATE SET
                            project_id = EXCLUDED.project_id,
                            provider = EXCLUDED.provider,
                            repo = EXCLUDED.repo,
                            default_branch = EXCLUDED.default_branch,
                            branch_prefix = EXCLUDED.branch_prefix
                        """,
                        (
                            tenant_id,
                            token["id"],
                            repo_row["project_id"],
                            repo_row["id"],
                            repo_row["provider"],
                            repo_row["repo"],
                            repo_row["default_branch"],
                            repo_row["branch_prefix"],
                        ),
                    )
    record_activity(tenant_id, current_user["id"], "agent_token_created", f"Created agent token {token['name']}", metadata={"agent_token_id": str(token["id"]), "allowed_repo": allowed_repo})
    return {"token": row_to_json(token), "raw_token": raw_token}


@router.get("/context")
def get_agent_context(current_agent: dict = Depends(require_agent_rate_limit)):
    tenant_id = str(current_agent["tenant_id"])
    agent = {
        "id": str(current_agent["id"]),
        "name": str(current_agent["name"]),
        "type": "CODING_AGENT",
    }
    workspace = fetch_one("SELECT id, name FROM tenants WHERE id = %s", (tenant_id,))
    allowed_projects = build_agent_project_tree(tenant_id, current_agent["id"])
    if not allowed_projects and current_agent.get("allowed_repo"):
        repo_value = ensure_safe_repo(current_agent.get("allowed_repo"))
        if repo_value:
            fallback_rows = fetch_all(
                """
                SELECT pr.id, pr.tenant_id, pr.project_id, pr.provider, pr.repo, pr.default_branch, pr.branch_prefix, pr.is_default, pr.status,
                       p.key AS project_key, p.name AS project_name
                FROM project_repositories pr
                JOIN projects p ON p.id = pr.project_id
                WHERE pr.tenant_id = %s AND pr.repo = %s AND pr.status = 'ACTIVE'
                ORDER BY pr.is_default DESC, pr.created_at ASC
                """,
                (tenant_id, repo_value),
            )
            if fallback_rows:
                grouped: dict[str, dict] = {}
                for row in rows_to_json(fallback_rows):
                    project_id = str(row["project_id"])
                    grouped.setdefault(project_id, {"id": project_id, "name": row["project_name"], "key": row["project_key"], "repositories": []})
                    grouped[project_id]["repositories"].append(
                        {
                            "id": str(row["id"]),
                            "provider": row["provider"],
                            "repo": row["repo"],
                            "default_branch": row["default_branch"],
                            "branch_prefix": row["branch_prefix"],
                        }
                    )
                allowed_projects = list(grouped.values())
    return {
        "agent": agent,
        "workspace": row_to_json(workspace) if workspace else {"id": tenant_id},
        "allowed_projects": allowed_projects,
        "capabilities": {
            "can_list_tasks": True,
            "can_claim_tasks": True,
            "can_update_status": True,
            "can_attach_pr": True,
            "can_mark_done": False,
            "can_delete_tasks": False,
        },
        "workflow_rules": {
            "claim_ttl_minutes": get_settings().agent_claim_minutes,
            "review_required": True,
            "done_requires_pr_merge": True,
        },
    }


@router.get("/tasks/available")
def list_available_tasks(
    repo: str | None = None,
    priority: str | None = None,
    labels: str | None = None,
    max_results: int = Query(default=20, ge=1, le=100),
    current_agent: dict = Depends(require_agent_rate_limit),
):
    agent = agent_context(current_agent)
    where = [
        "i.ai_pickable = true",
        "(i.claimed_by_agent IS NULL OR i.claim_expires_at < now() OR i.agent_status IN ('AVAILABLE', 'RELEASED', 'FAILED'))",
    ]
    params: list = []
    repo_value = ensure_safe_repo(repo)
    if priority:
        where.append("i.priority = %s")
        params.append(priority)
    if labels:
        label_items = [item.strip() for item in labels.split(",") if item.strip()]
        if label_items:
            where.append("i.labels && %s")
            params.append(label_items)
    rows = issue_list_rows(agent.tenant_id, where, params)
    tasks = []
    for row in rows:
        if repo_value and row.get("github_repo") != repo_value and row.get("repository_name") != repo_value:
            continue
        if not issue_repo_access_ok(row, agent):
            continue
        if row.get("ai_pickable") and not (row.get("repository_id") or row.get("github_repo")):
            continue
        tasks.append(task_response(row, agent.tenant_id)["task"])
        if len(tasks) >= max_results:
            break
    return {"tasks": tasks}


@router.get("/tasks/{task_id}")
def get_task_details(task_id: str, current_agent: dict = Depends(require_agent_rate_limit)):
    agent = agent_context(current_agent)
    issue = issue_row(task_id, agent.tenant_id)
    if not issue_repo_access_ok(issue, agent):
        raise HTTPException(status_code=403, detail="Task repo is not allowed for this agent")
    task_payload = task_response(issue, agent.tenant_id)
    return {
        **task_payload,
        "activity_timeline": issue_activity_timeline(task_id, agent.tenant_id),
        "external_links": current_task_links(task_id, agent.tenant_id),
        "agent_comments": current_task_comments(task_id, agent.tenant_id),
    }


@router.post("/tasks/{task_id}/claim")
def claim_task(task_id: str, payload: ClaimRequest, current_agent: dict = Depends(require_agent_rate_limit)):
    agent = agent_context(current_agent)
    issue = issue_row(task_id, agent.tenant_id)
    if not issue_repo_access_ok(issue, agent):
        if issue.get("ai_pickable") and not (issue.get("repository_id") or issue.get("github_repo")):
            repo_count = fetch_one(
                "SELECT COUNT(*)::int AS repo_count FROM project_repositories WHERE tenant_id = %s AND project_id = %s AND status = 'ACTIVE'",
                (agent.tenant_id, issue["project_id"]),
            )
            if (repo_count or {}).get("repo_count", 0) > 1:
                raise HTTPException(status_code=409, detail="Task repository must be selected before an agent can claim it")
        raise HTTPException(status_code=403, detail="Repository is not allowed for this task or agent")
    claimed_issue, claim = claim_task_workflow(task_id, agent.tenant_id, agent, payload.claim_minutes or get_settings().agent_claim_minutes)
    return {**task_response(claimed_issue, agent.tenant_id), "claim": row_to_json(claim)}


@router.post("/tasks/{task_id}/comment")
def add_task_comment(task_id: str, payload: CommentRequest, current_agent: dict = Depends(require_agent_rate_limit)):
    agent = agent_context(current_agent)
    issue = issue_row(task_id, agent.tenant_id)
    if issue.get("claimed_by_agent") != agent.name:
        raise HTTPException(status_code=403, detail="Task is not claimed by this agent")
    comment = record_automation_event(
        agent.tenant_id,
        task_id,
        "agent",
        payload.body.strip(),
        actor_name=agent.name,
        event_type="agent_comment",
        metadata={"body": payload.body.strip()},
    )
    record_activity(agent.tenant_id, current_agent["id"], "agent_comment", f"{agent.name} commented on {issue['issue_key']}", issue_id=task_id, project_id=issue["project_id"], metadata={"body": payload.body.strip()})
    return {"comment": row_to_json(comment)}


@router.post("/tasks/{task_id}/status")
def update_task_status(task_id: str, payload: StatusRequest, current_agent: dict = Depends(require_agent_rate_limit)):
    agent = agent_context(current_agent)
    issue = issue_row(task_id, agent.tenant_id)
    if issue.get("claimed_by_agent") != agent.name:
        raise HTTPException(status_code=403, detail="Task is not claimed by this agent")
    next_status = payload.status.replace("REVIEW", "IN_REVIEW") if payload.status == "REVIEW" else payload.status
    safe_transition_status(issue["status"], next_status)
    updated = update_task_status_workflow(task_id, agent.tenant_id, agent, next_status, payload.note)
    return task_response(updated, agent.tenant_id)


@router.post("/tasks/{task_id}/pull-request")
def attach_pull_request(task_id: str, payload: PullRequestRequest, current_agent: dict = Depends(require_agent_rate_limit)):
    agent = agent_context(current_agent)
    if task_id != payload.task_id:
        raise HTTPException(status_code=400, detail="Task ID mismatch")
    updated = attach_pull_request_workflow(
        task_id,
        agent.tenant_id,
        agent,
        repo=payload.repo,
        branch=payload.branch,
        pr_url=payload.pr_url,
        pr_number=payload.pr_number,
        summary=payload.summary,
        test_notes=payload.test_notes,
        changed_files=payload.changed_files,
    )
    return task_response(updated, agent.tenant_id)


@router.post("/tasks/{task_id}/submit-review")
def submit_work_for_review(task_id: str, payload: SubmitReviewRequest, current_agent: dict = Depends(require_agent_rate_limit)):
    agent = agent_context(current_agent)
    if task_id != payload.task_id:
        raise HTTPException(status_code=400, detail="Task ID mismatch")
    updated = submit_work_for_review_workflow(
        task_id,
        agent.tenant_id,
        agent,
        repo=payload.repo,
        branch=payload.branch,
        pr_url=payload.pr_url,
        pr_number=payload.pr_number,
        summary=payload.summary,
        test_notes=payload.test_notes,
        changed_files=payload.changed_files,
    )
    return task_response(updated, agent.tenant_id)


@router.post("/tasks/{task_id}/release")
def release_task(task_id: str, payload: ReleaseRequest, current_agent: dict = Depends(require_agent_rate_limit)):
    agent = agent_context(current_agent)
    updated = release_task_workflow(task_id, agent.tenant_id, agent, back_to_todo=payload.return_to_todo, reason=payload.reason)
    return task_response(updated, agent.tenant_id)


@router.post("/tasks/{task_id}/blocked")
def mark_task_blocked(task_id: str, payload: BlockedRequest, current_agent: dict = Depends(require_agent_rate_limit)):
    agent = agent_context(current_agent)
    updated = set_task_blocked(task_id, agent.tenant_id, agent, payload.reason.strip())
    return task_response(updated, agent.tenant_id)


@webhook_router.post("/github")
async def github_webhook(request: Request):
    body = await request.body()
    signature = request.headers.get("x-hub-signature-256")
    if not verify_github_signature(get_settings().github_webhook_secret, body, signature):
        raise HTTPException(status_code=401, detail="Invalid GitHub signature")

    payload = await request.json()
    event = request.headers.get("x-github-event", "")
    action = payload.get("action")
    repository = payload.get("repository") or {}
    repo_full_name = ensure_safe_repo(repository.get("full_name"))
    if not repo_full_name:
        return {"ok": True, "ignored": True}

    issue = None
    pr = payload.get("pull_request") or {}
    pr_number = pr.get("number") or payload.get("number")
    pr_url = pr.get("html_url")
    if event in {"pull_request", "pull_request_review", "check_suite", "workflow_run"}:
        issue = find_issue_by_pr(repo_full_name, pr_number=pr_number, pr_url=pr_url)
    if not issue:
        return {"ok": True, "ignored": True}

    tenant_id = str(issue["tenant_id"])
    issue_id = str(issue["id"])

    if event == "pull_request":
        if action in {"opened", "reopened", "synchronize", "review_requested"}:
            next_status = "IN_REVIEW"
            next_agent_status = "SUBMITTED" if action in {"opened", "reopened"} else "WORKING"
            github_pr_status = "OPEN" if action in {"opened", "reopened"} else "UPDATED"
            updated = execute(
                """
                UPDATE issues
                SET status = %s,
                    agent_status = %s,
                    github_pr_status = %s,
                    github_branch = COALESCE(%s, github_branch),
                    updated_at = now()
                WHERE id = %s AND tenant_id = %s
                RETURNING *
                """,
                (next_status, next_agent_status, github_pr_status, pr.get("head", {}).get("ref"), issue_id, tenant_id),
            )
            record_automation_event(tenant_id, issue_id, "github", f"Pull request {action} for {updated['issue_key']}", actor_name=repo_full_name, event_type="github_pull_request", metadata={"action": action, "pr_number": pr_number, "pr_url": pr_url})
        elif action == "closed":
            merged = bool(pr.get("merged"))
            updated = execute(
                """
                UPDATE issues
                SET status = %s,
                    agent_status = %s,
                    claimed_by_agent = NULL,
                    claim_expires_at = NULL,
                    github_pr_status = %s,
                    updated_at = now()
                WHERE id = %s AND tenant_id = %s
                RETURNING *
                """,
                ("DONE" if merged else "BLOCKED", "AVAILABLE" if merged else "FAILED", "MERGED" if merged else "CLOSED", issue_id, tenant_id),
            )
            record_automation_event(tenant_id, issue_id, "github", f"Pull request {'merged' if merged else 'closed'} for {updated['issue_key']}", actor_name=repo_full_name, event_type="github_pull_request", metadata={"action": action, "merged": merged, "pr_number": pr_number, "pr_url": pr_url})
        else:
            updated = execute(
                """
                UPDATE issues
                SET github_pr_status = COALESCE(%s, github_pr_status),
                    updated_at = now()
                WHERE id = %s AND tenant_id = %s
                RETURNING *
                """,
                (action.upper(), issue_id, tenant_id),
            )
    elif event == "pull_request_review":
        review_state = (payload.get("review") or {}).get("state")
        if review_state == "changes_requested":
            updated = execute(
                """
                UPDATE issues
                SET status = 'CHANGES_REQUESTED',
                    github_pr_status = 'CHANGES_REQUESTED',
                    updated_at = now()
                WHERE id = %s AND tenant_id = %s
                RETURNING *
                """,
                (issue_id, tenant_id),
            )
        else:
            updated = execute(
                """
                UPDATE issues
                SET github_pr_status = %s,
                    updated_at = now()
                WHERE id = %s AND tenant_id = %s
                RETURNING *
                """,
                (review_state.upper() if review_state else "REVIEWED", issue_id, tenant_id),
            )
        record_automation_event(tenant_id, issue_id, "github", f"Review {review_state or 'updated'} for {updated['issue_key']}", actor_name=repo_full_name, event_type="github_review", metadata={"state": review_state})
    elif event in {"check_suite", "workflow_run"}:
        conclusion = (payload.get("check_suite") or payload.get("workflow_run") or {}).get("conclusion")
        status = "CI_PASSED" if conclusion in {"success", "neutral", "skipped"} else "CI_FAILED"
        updated = execute(
            """
            UPDATE issues
            SET github_pr_status = %s,
                status = CASE WHEN %s = 'CI_FAILED' THEN CASE WHEN status = 'DONE' THEN 'DONE' ELSE status END ELSE status END,
                updated_at = now()
            WHERE id = %s AND tenant_id = %s
            RETURNING *
                """,
            (status, status, issue_id, tenant_id),
        )
        record_automation_event(tenant_id, issue_id, "github", f"CI {conclusion or 'updated'} for {updated['issue_key']}", actor_name=repo_full_name, event_type="github_check", metadata={"conclusion": conclusion})
    else:
        return {"ok": True, "ignored": True}

    record_activity(tenant_id, None, "github_webhook", f"Processed {event} for {updated['issue_key']}", project_id=updated["project_id"], issue_id=issue_id, metadata={"event": event, "action": action, "repo": repo_full_name})
    return {"ok": True}
