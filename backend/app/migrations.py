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
                CREATE TABLE IF NOT EXISTS project_repositories (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    provider TEXT NOT NULL DEFAULT 'github',
                    repo TEXT NOT NULL,
                    default_branch TEXT NOT NULL DEFAULT 'main',
                    branch_prefix TEXT NOT NULL DEFAULT '',
                    is_default BOOLEAN NOT NULL DEFAULT false,
                    status TEXT NOT NULL DEFAULT 'ACTIVE',
                    created_by UUID REFERENCES users(id),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    UNIQUE (tenant_id, project_id, provider, repo)
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_repo_access (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    agent_id UUID NOT NULL REFERENCES agent_tokens(id) ON DELETE CASCADE,
                    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    project_repository_id UUID NOT NULL REFERENCES project_repositories(id) ON DELETE CASCADE,
                    provider TEXT NOT NULL DEFAULT 'github',
                    repo TEXT NOT NULL,
                    default_branch TEXT NOT NULL DEFAULT 'main',
                    branch_prefix TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    UNIQUE (agent_id, project_repository_id)
                )
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
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_tokens (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    allowed_repo TEXT,
                    scopes TEXT[] NOT NULL DEFAULT '{tasks,comments,status,pull_request}',
                    active BOOLEAN NOT NULL DEFAULT true,
                    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
                    last_used_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS agent_claims (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
                    agent_token_id UUID REFERENCES agent_tokens(id) ON DELETE SET NULL,
                    claimed_by_agent TEXT NOT NULL,
                    claim_expires_at TIMESTAMPTZ NOT NULL,
                    released_at TIMESTAMPTZ,
                    release_reason TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    UNIQUE (issue_id)
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS external_links (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
                    link_type TEXT NOT NULL,
                    url TEXT NOT NULL,
                    title TEXT DEFAULT '',
                    metadata JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS automation_events (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                    issue_id UUID REFERENCES issues(id) ON DELETE CASCADE,
                    actor_kind TEXT NOT NULL,
                    actor_name TEXT,
                    event_type TEXT NOT NULL,
                    message TEXT NOT NULL,
                    metadata JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            )
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_invite_code ON tenants(invite_code)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_project_repositories_tenant_project ON project_repositories(tenant_id, project_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_project_repositories_tenant_repo ON project_repositories(tenant_id, provider, repo)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tenant_members_user_status ON tenant_members(user_id, status)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant_joined_at ON tenant_members(tenant_id, joined_at)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_sprints_tenant_project_status_start ON sprints(tenant_id, project_id, status, start_date)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_issues_tenant_project_status_position ON issues(tenant_id, project_id, status, position)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_issues_repository ON issues(tenant_id, repository_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_issues_agent_status ON issues(tenant_id, agent_status)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_issues_ai_pickable ON issues(tenant_id, ai_pickable, agent_status)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_agent_tokens_tenant ON agent_tokens(tenant_id, active)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_agent_repo_access_agent ON agent_repo_access(tenant_id, agent_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_agent_repo_access_project ON agent_repo_access(tenant_id, project_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_agent_claims_tenant_issue ON agent_claims(tenant_id, issue_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_external_links_issue ON external_links(issue_id, created_at DESC)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_automation_events_tenant_issue ON automation_events(tenant_id, issue_id, created_at DESC)")
