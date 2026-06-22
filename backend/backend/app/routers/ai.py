from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from ..database import fetch_all, fetch_one
from ..security import get_current_user
from ..utils import rows_to_json, row_to_json

router = APIRouter(prefix="/api/ai", tags=["ai"])


class BreakdownRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=5000)
    project_id: str | None = None


class SprintPlanRequest(BaseModel):
    project_id: str
    sprint_id: str | None = None
    capacity_points: int = Field(default=30, ge=1, le=300)


class AcceptanceCriteriaRequest(BaseModel):
    title: str = Field(min_length=3, max_length=240)
    description: str = ""


def split_theme(prompt: str) -> list[str]:
    words = [w.strip(".,;:!?()[]{}") for w in prompt.split() if len(w.strip(".,;:!?()[]{}")) > 2]
    unique = []
    for word in words:
        value = word.lower()
        if value not in unique:
            unique.append(value)
    return unique[:8] or ["requirements", "implementation", "testing"]


def resolve_tenant_id(current_user: dict) -> str:
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Workspace not selected")
    return str(tenant_id)


@router.post("/breakdown")
def breakdown(payload: BreakdownRequest, current_user: dict = Depends(get_current_user)):
    themes = split_theme(payload.prompt)
    core_title = payload.prompt.strip().rstrip(".")
    tasks = [
        {
            "title": f"Clarify requirements for {core_title}",
            "issue_type": "TASK",
            "priority": "HIGH",
            "story_points": 3,
            "acceptance_criteria": [
                "Business goal is documented",
                "Main users and edge cases are identified",
                "Out-of-scope items are listed",
            ],
        },
        {
            "title": f"Design backend model and API for {core_title}",
            "issue_type": "STORY",
            "priority": "HIGH",
            "story_points": 5,
            "acceptance_criteria": [
                "Database model supports the required workflow",
                "API validates inputs and enforces tenant isolation",
                "Failure responses are clear and consistent",
            ],
        },
        {
            "title": f"Build user workflow for {core_title}",
            "issue_type": "STORY",
            "priority": "MEDIUM",
            "story_points": 5,
            "acceptance_criteria": [
                "User can complete the main workflow without manual backend changes",
                "Important states are visible in the UI",
                "Empty and error states are handled",
            ],
        },
        {
            "title": f"Add validation and permission checks for {core_title}",
            "issue_type": "TASK",
            "priority": "HIGH",
            "story_points": 3,
            "acceptance_criteria": [
                "Only authorized users can modify data",
                "Invalid transitions are blocked",
                "Tenant data cannot leak across workspaces",
            ],
        },
        {
            "title": f"Test and release {core_title}",
            "issue_type": "TASK",
            "priority": "MEDIUM",
            "story_points": 3,
            "acceptance_criteria": [
                "Happy path is tested",
                "Important edge cases are tested",
                "Deployment notes are documented",
            ],
        },
    ]
    risks = [
        "Requirements may be too broad; split into smaller issues before sprint start.",
        "Permission and tenant-isolation bugs can be costly; test these early.",
        "Avoid starting UI polish before core workflow is stable.",
    ]
    return {"mode": "heuristic", "themes": themes, "tasks": tasks, "risks": risks}


@router.post("/acceptance-criteria")
def acceptance_criteria(payload: AcceptanceCriteriaRequest, current_user: dict = Depends(get_current_user)):
    title = payload.title.strip()
    criteria = [
        f"Given a valid user, when they use '{title}', then the expected business outcome is completed successfully.",
        "Invalid inputs return clear validation errors without saving partial data.",
        "The workflow respects tenant isolation and role permissions.",
        "Relevant activity is recorded for audit and collaboration.",
        "The feature handles empty, loading, and error states gracefully.",
    ]
    return {"mode": "heuristic", "acceptance_criteria": criteria}


@router.post("/sprint-plan")
def sprint_plan(payload: SprintPlanRequest, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    project = fetch_one("SELECT id FROM projects WHERE id = %s AND tenant_id = %s", (payload.project_id, tenant_id))
    if not project:
        return {"mode": "heuristic", "selected_issues": [], "message": "Project not found"}
    rows = fetch_all(
        """
        SELECT id, tenant_id, project_id, issue_key, title, status, priority, story_points, sprint_id, assignee_id, due_date, created_at
        FROM issues
        WHERE tenant_id = %s AND project_id = %s AND sprint_id IS NULL AND status = 'BACKLOG'
        ORDER BY
          CASE priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
          created_at ASC
        """,
        (tenant_id, payload.project_id),
    )
    selected = []
    total = 0
    for issue in rows:
        points = int(issue["story_points"] or 1)
        if total + points <= payload.capacity_points:
            selected.append(issue)
            total += points
    return {
        "mode": "heuristic",
        "capacity_points": payload.capacity_points,
        "planned_points": total,
        "selected_issues": rows_to_json(selected),
        "notes": [
            "Selection prioritizes urgent/high priority backlog items first.",
            "Review dependencies manually before starting the sprint.",
            "Keep 15-20% capacity buffer for bugs and operational work.",
        ],
    }


@router.post("/sprint-insights")
def sprint_insights(payload: SprintPlanRequest, current_user: dict = Depends(get_current_user)):
    if not payload.sprint_id:
        return {"mode": "heuristic", "insights": ["Select a sprint to get sprint-specific insights."]}
    tenant_id = resolve_tenant_id(current_user)
    sprint = fetch_one("SELECT id, name FROM sprints WHERE id = %s AND tenant_id = %s", (payload.sprint_id, tenant_id))
    if not sprint:
        return {"mode": "heuristic", "insights": ["Sprint not found."]}
    summary = fetch_one(
        """
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status = 'DONE') AS done,
               COUNT(*) FILTER (WHERE status = 'BLOCKED') AS blocked,
               COALESCE(SUM(story_points), 0) AS points,
               COALESCE(SUM(story_points) FILTER (WHERE status = 'DONE'), 0) AS done_points
        FROM issues WHERE tenant_id = %s AND sprint_id = %s
        """,
        (tenant_id, payload.sprint_id),
    )
    total = summary["total"] or 0
    done = summary["done"] or 0
    blocked = summary["blocked"] or 0
    completion = round((done / total) * 100, 1) if total else 0
    insights = [f"Sprint completion is {completion}% based on completed issue count."]
    if blocked:
        insights.append(f"There are {blocked} blocked issues; unblock these before pulling new work.")
    if total and completion < 40:
        insights.append("Completion is low; reduce scope or focus the team on high-priority work.")
    if summary["points"] and summary["done_points"] < summary["points"] * 0.5:
        insights.append("Less than half of story points are done; review estimates and dependencies.")
    if not insights:
        insights.append("Sprint looks healthy based on current issue distribution.")
    return {"mode": "heuristic", "sprint": row_to_json(sprint), "summary": row_to_json(summary), "insights": insights}
