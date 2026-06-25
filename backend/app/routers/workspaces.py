from fastapi import APIRouter, Depends, HTTPException
from ..security import get_current_user
from ..database import fetch_one
from ..services.memberships import memberships_for_user
from ..utils import row_to_json
from ..services.workspace_defaults import ensure_workspace_board_defaults, get_workspace_sprint_schedule

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


@router.get("/board")
def board_defaults(current_user: dict = Depends(get_current_user)):
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    defaults = ensure_workspace_board_defaults(tenant_id)
    return defaults


@router.get("/schedule")
def schedule(current_user: dict = Depends(get_current_user)):
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    return get_workspace_sprint_schedule(tenant_id)


@router.get("/{workspace_slug}/tasks/{task_key}")
def get_workspace_task(workspace_slug: str, task_key: str, current_user: dict = Depends(get_current_user)):
    user_memberships = memberships_for_user(str(current_user["id"]))
    membership = next((row for row in user_memberships if row.get("tenant_slug") == workspace_slug), None)
    if not membership:
        raise HTTPException(status_code=403, detail="Cannot access this workspace")
    try:
        issue = fetch_one(
            """
            SELECT i.id, i.tenant_id, i.project_id, i.sprint_id, i.issue_key, i.title, i.description, i.issue_type, i.status, i.priority,
                   i.ai_pickable, i.agent_status, i.claimed_by_agent, i.claim_expires_at, i.repository_id, i.github_repo, i.github_branch, i.github_pr_url,
                   i.github_pr_number, i.github_pr_status, i.agent_summary, i.agent_test_notes, i.agent_blocker_reason,
                   i.assignee_id, i.reporter_id, i.story_points, i.due_date, i.labels, i.position, i.created_at, i.updated_at,
                   p.key AS project_key, p.name AS project_name,
                   pr.repo AS repository_name, pr.provider AS repository_provider, pr.default_branch AS repository_default_branch, pr.branch_prefix AS repository_branch_prefix,
                   au.name AS assignee_name, ru.name AS reporter_name, s.name AS sprint_name
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            LEFT JOIN project_repositories pr ON pr.id = i.repository_id
            LEFT JOIN users au ON au.id = i.assignee_id
            LEFT JOIN users ru ON ru.id = i.reporter_id
            LEFT JOIN sprints s ON s.id = i.sprint_id
            WHERE i.tenant_id = %s AND i.issue_key = %s
            """,
            (membership["tenant_id"], task_key),
        )
    except Exception as exc:
        message = str(exc).lower()
        if "does not exist" not in message:
            raise
        issue = fetch_one(
            """
            SELECT i.id, i.tenant_id, i.project_id, i.sprint_id, i.issue_key, i.title, i.description, i.issue_type, i.status, i.priority,
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
                   i.assignee_id, i.reporter_id, i.story_points, i.due_date, i.labels, i.position, i.created_at, i.updated_at,
                   p.key AS project_key, p.name AS project_name,
                   au.name AS assignee_name, ru.name AS reporter_name, s.name AS sprint_name
            FROM issues i
            JOIN projects p ON p.id = i.project_id
            LEFT JOIN users au ON au.id = i.assignee_id
            LEFT JOIN users ru ON ru.id = i.reporter_id
            LEFT JOIN sprints s ON s.id = i.sprint_id
            WHERE i.tenant_id = %s AND i.issue_key = %s
            """,
            (membership["tenant_id"], task_key),
        )
    if not issue:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"issue": row_to_json(issue)}
