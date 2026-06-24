from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from ..database import fetch_all, fetch_one, execute
from ..security import get_current_user
from ..utils import row_to_json, rows_to_json
from ..services.activity import record_activity
from ..services.agent_workflow import ISSUE_SELECT_COLUMNS
from ..sse import event_bus

router = APIRouter(prefix="/api/issues/{issue_id}/comments", tags=["comments"])


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


def ensure_issue(issue_id: str, tenant_id: str):
    issue = fetch_one(
        f"SELECT {ISSUE_SELECT_COLUMNS} FROM issues WHERE id = %s AND tenant_id = %s",
        (issue_id, tenant_id),
    )
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


def resolve_tenant_id(current_user: dict) -> str:
    tenant_id = current_user.get("tenant_id") or current_user.get("active_tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Workspace not selected")
    return str(tenant_id)


@router.get("")
def list_comments(issue_id: str, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    ensure_issue(issue_id, tenant_id)
    rows = fetch_all(
        """
        SELECT c.*, u.name AS author_name, u.email AS author_email
        FROM comments c
        LEFT JOIN users u ON u.id = c.author_id
        WHERE c.issue_id = %s AND c.tenant_id = %s
        ORDER BY c.created_at ASC
        """,
        (issue_id, tenant_id),
    )
    return {"comments": rows_to_json(rows)}


@router.post("")
async def add_comment(issue_id: str, payload: CommentCreate, current_user: dict = Depends(get_current_user)):
    tenant_id = resolve_tenant_id(current_user)
    issue = ensure_issue(issue_id, tenant_id)
    comment = execute(
        """
        INSERT INTO comments (tenant_id, issue_id, author_id, body)
        VALUES (%s, %s, %s, %s)
        RETURNING *
        """,
        (tenant_id, issue_id, current_user["id"], payload.body.strip()),
    )
    record_activity(tenant_id, current_user["id"], "comment_created", f"Commented on {issue['issue_key']}", project_id=issue["project_id"], issue_id=issue_id, metadata={"comment_id": str(comment["id"])})
    await event_bus.publish(tenant_id, "comment_created", {"issue_id": issue_id, "comment": row_to_json(comment)})
    return {"comment": row_to_json(comment)}
