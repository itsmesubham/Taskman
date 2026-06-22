import re
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "tenant"


def project_key(value: str) -> str:
    letters = re.sub(r"[^a-zA-Z0-9]", "", value.upper())
    if not letters:
        return "PROJ"
    return letters[:10]


def serialize(value: Any) -> Any:
    if isinstance(value, list):
        return [serialize(v) for v in value]
    if isinstance(value, dict):
        return {k: serialize(v) for k, v in value.items()}
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    return value


def rows_to_json(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [serialize(row) for row in rows]


def row_to_json(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return serialize(row)
