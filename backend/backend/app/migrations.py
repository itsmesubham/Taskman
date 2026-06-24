from pathlib import Path
from .database import get_conn


def init_schema() -> None:
    schema_path = Path(__file__).with_name("schema.sql")
    sql = schema_path.read_text()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                ALTER TABLE IF EXISTS issues
                ALTER COLUMN position TYPE BIGINT
                """
            )
            for statement in [
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS ai_pickable BOOLEAN NOT NULL DEFAULT false",
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS agent_status TEXT NOT NULL DEFAULT 'AVAILABLE'",
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS claimed_by_agent TEXT",
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ",
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS repository_id UUID",
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS github_repo TEXT",
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS github_branch TEXT",
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS github_pr_url TEXT",
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS github_pr_number INTEGER",
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS github_pr_status TEXT",
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS agent_summary TEXT DEFAULT ''",
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS agent_test_notes TEXT DEFAULT ''",
                "ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS agent_blocker_reason TEXT DEFAULT ''",
            ]:
                cur.execute(statement)
            cur.execute(sql)
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
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tenant_members_user_status ON tenant_members(user_id, status)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant_joined_at ON tenant_members(tenant_id, joined_at)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_sprints_tenant_project_status_start ON sprints(tenant_id, project_id, status, start_date)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_issues_tenant_project_status_position ON issues(tenant_id, project_id, status, position)")
