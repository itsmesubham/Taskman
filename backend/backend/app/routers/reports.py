from fastapi import APIRouter, Depends, HTTPException
from ..database import fetch_all, fetch_one
from ..security import get_current_user
from ..utils import row_to_json, rows_to_json

router = APIRouter(prefix="/api/reports", tags=["reports"])


def resolve_tenant_id(current_user: dict) -> str:
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Workspace not selected")
    return str(tenant_id)


@router.get("/dashboard")
def dashboard(current_user: dict = Depends(get_current_user), project_id: str | None = None):
    tenant_id = resolve_tenant_id(current_user)
    params = [tenant_id]
    project_filter = ""
    if project_id:
        project_filter = " AND project_id = %s"
        params.append(project_id)

    totals = fetch_one(
        f"""
        SELECT
            COUNT(*) AS total_issues,
            COUNT(*) FILTER (WHERE status = 'DONE') AS done_issues,
            COUNT(*) FILTER (WHERE status = 'BLOCKED') AS blocked_issues,
            COUNT(*) FILTER (WHERE priority IN ('HIGH', 'URGENT')) AS high_priority_issues,
            COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE AND status != 'DONE') AS overdue_issues,
            COALESCE(SUM(story_points), 0) AS total_points,
            COALESCE(SUM(story_points) FILTER (WHERE status = 'DONE'), 0) AS done_points
        FROM issues
        WHERE tenant_id = %s {project_filter}
        """,
        tuple(params),
    )
    projects = fetch_one("SELECT COUNT(*) AS total_projects FROM projects WHERE tenant_id = %s AND status != 'ARCHIVED'", (tenant_id,))
    active_sprints = fetch_all(
        """
        SELECT s.id, s.tenant_id, s.project_id, s.name, s.goal, s.status, s.start_date, s.end_date, s.created_at, s.updated_at,
               p.key AS project_key,
               COUNT(i.id) AS issue_count,
               COUNT(i.id) FILTER (WHERE i.status = 'DONE') AS done_count
        FROM sprints s
        JOIN projects p ON p.id = s.project_id
        LEFT JOIN issues i ON i.sprint_id = s.id
        WHERE s.tenant_id = %s AND s.status = 'ACTIVE'
        GROUP BY s.id, p.key
        ORDER BY s.created_at DESC
        """,
        (tenant_id,),
    )
    status_distribution = fetch_all("SELECT status, COUNT(*) AS count FROM issues WHERE tenant_id = %s GROUP BY status ORDER BY status", (tenant_id,))
    priority_distribution = fetch_all("SELECT priority, COUNT(*) AS count FROM issues WHERE tenant_id = %s GROUP BY priority ORDER BY priority", (tenant_id,))
    assignee_workload = fetch_all(
        """
        SELECT u.id, u.name, COUNT(i.id) AS issue_count, COALESCE(SUM(i.story_points), 0) AS story_points
        FROM issues i
        LEFT JOIN users u ON u.id = i.assignee_id
        WHERE i.tenant_id = %s AND i.status != 'DONE'
        GROUP BY u.id, u.name
        ORDER BY issue_count DESC
        LIMIT 20
        """,
        (tenant_id,),
    )
    recent_activity = fetch_all(
        """
        SELECT ae.*, u.name AS actor_name
        FROM activity_events ae
        LEFT JOIN users u ON u.id = ae.actor_id
        WHERE ae.tenant_id = %s
        ORDER BY ae.created_at DESC
        LIMIT 25
        """,
        (tenant_id,),
    )
    return {
        "summary": row_to_json({**totals, **projects}),
        "active_sprints": rows_to_json(active_sprints),
        "status_distribution": rows_to_json(status_distribution),
        "priority_distribution": rows_to_json(priority_distribution),
        "assignee_workload": rows_to_json(assignee_workload),
        "recent_activity": rows_to_json(recent_activity),
    }


@router.get("/sprint/{sprint_id}")
def sprint_report(sprint_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    sprint = fetch_one("SELECT id, tenant_id, project_id, name, goal, status, start_date, end_date, created_at, updated_at FROM sprints WHERE id = %s AND tenant_id = %s", (sprint_id, tenant_id))
    if not sprint:
        raise HTTPException(status_code=404, detail="Sprint not found")
    summary = fetch_one(
        """
        SELECT
            COUNT(*) AS total_issues,
            COUNT(*) FILTER (WHERE status = 'DONE') AS done_issues,
            COUNT(*) FILTER (WHERE status = 'BLOCKED') AS blocked_issues,
            COALESCE(SUM(story_points), 0) AS total_points,
            COALESCE(SUM(story_points) FILTER (WHERE status = 'DONE'), 0) AS done_points
        FROM issues
        WHERE tenant_id = %s AND sprint_id = %s
        """,
        (tenant_id, sprint_id),
    )
    by_status = fetch_all("SELECT status, COUNT(*) AS count FROM issues WHERE tenant_id = %s AND sprint_id = %s GROUP BY status", (tenant_id, sprint_id))
    return {"sprint": row_to_json(sprint), "summary": row_to_json(summary), "by_status": rows_to_json(by_status)}
