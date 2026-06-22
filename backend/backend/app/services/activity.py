from typing import Any
import json
from ..database import execute
from ..utils import serialize


def record_activity(
    tenant_id: str,
    actor_id: str | None,
    event_type: str,
    message: str,
    project_id: str | None = None,
    issue_id: str | None = None,
    sprint_id: str | None = None,
    metadata: dict[str, Any] | None = None,
):
    return execute(
        """
        INSERT INTO activity_events (tenant_id, project_id, issue_id, sprint_id, actor_id, event_type, message, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        RETURNING *
        """,
        (
            tenant_id,
            project_id,
            issue_id,
            sprint_id,
            actor_id,
            event_type,
            message,
            json.dumps(serialize(metadata or {})),
        ),
    )
