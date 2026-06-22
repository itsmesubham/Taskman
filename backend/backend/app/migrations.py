from pathlib import Path
from .database import get_conn


def init_schema() -> None:
    schema_path = Path(__file__).with_name("schema.sql")
    sql = schema_path.read_text()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            cur.execute(
                """
                ALTER TABLE IF EXISTS issues
                ALTER COLUMN position TYPE BIGINT
                """
            )
