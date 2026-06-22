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
            cur.execute(
                """
                ALTER TABLE IF EXISTS projects
                ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'EVERYONE'
                """
            )
            cur.execute(
                """
                ALTER TABLE IF EXISTS tenants
                ADD COLUMN IF NOT EXISTS invite_code TEXT
                """
            )
            cur.execute(
                """
                ALTER TABLE IF EXISTS tenants
                ADD COLUMN IF NOT EXISTS invite_enabled BOOLEAN NOT NULL DEFAULT true
                """
            )
            cur.execute(
                """
                ALTER TABLE IF EXISTS tenants
                ADD COLUMN IF NOT EXISTS invite_created_at TIMESTAMPTZ
                """
            )
            cur.execute(
                """
                ALTER TABLE IF EXISTS tenants
                ADD COLUMN IF NOT EXISTS invite_regenerated_at TIMESTAMPTZ
                """
            )
            cur.execute(
                """
                ALTER TABLE IF EXISTS users
                ADD COLUMN IF NOT EXISTS active_tenant_id UUID
                """
            )
            cur.execute(
                """
                ALTER TABLE IF EXISTS tenant_members
                ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE'
                """
            )
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_invite_code ON tenants(invite_code)")
