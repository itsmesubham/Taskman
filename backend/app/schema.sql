CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    invite_code TEXT UNIQUE,
    invite_enabled BOOLEAN NOT NULL DEFAULT true,
    invite_created_at TIMESTAMPTZ,
    invite_regenerated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    active_tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_members (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'MEMBER',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key TEXT NOT NULL,
    description TEXT DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'EVERYONE',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    issue_counter INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS github_installation_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nonce TEXT NOT NULL UNIQUE,
    state_token TEXT NOT NULL,
    installation_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at TIMESTAMPTZ,
    UNIQUE (tenant_id, user_id, nonce)
);

CREATE TABLE IF NOT EXISTS github_installations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    installation_id BIGINT NOT NULL UNIQUE,
    app_slug TEXT NOT NULL DEFAULT 'taskman-ai',
    account_login TEXT NOT NULL DEFAULT '',
    account_type TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'CONNECTED',
    synced_repository_count INTEGER NOT NULL DEFAULT 0,
    last_synced_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS github_repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    installation_id BIGINT NOT NULL,
    github_repository_id BIGINT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'github',
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    full_name TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private',
    default_branch TEXT NOT NULL DEFAULT 'main',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, github_repository_id),
    UNIQUE (tenant_id, installation_id, full_name)
);

CREATE TABLE IF NOT EXISTS project_repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    github_repository_id UUID REFERENCES github_repositories(id) ON DELETE SET NULL,
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
);

CREATE TABLE IF NOT EXISTS github_webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id TEXT NOT NULL UNIQUE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    goal TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PLANNED',
    start_date DATE,
    end_date DATE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS issues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sprint_id UUID REFERENCES sprints(id) ON DELETE SET NULL,
    issue_key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    issue_type TEXT NOT NULL DEFAULT 'TASK',
    status TEXT NOT NULL DEFAULT 'BACKLOG',
    priority TEXT NOT NULL DEFAULT 'MEDIUM',
    ai_pickable BOOLEAN NOT NULL DEFAULT false,
    agent_status TEXT NOT NULL DEFAULT 'AVAILABLE',
    claimed_by_agent TEXT,
    claim_expires_at TIMESTAMPTZ,
    repository_id UUID REFERENCES project_repositories(id) ON DELETE SET NULL,
    github_repo TEXT,
    github_branch TEXT,
    github_pr_url TEXT,
    github_pr_number INTEGER,
    github_pr_status TEXT,
    agent_summary TEXT DEFAULT '',
    agent_test_notes TEXT DEFAULT '',
    agent_blocker_reason TEXT DEFAULT '',
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
    story_points INTEGER DEFAULT 0,
    due_date DATE,
    labels TEXT[] NOT NULL DEFAULT '{}',
    position BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, issue_key)
);

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
);

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
);

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
);

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
);

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
);

CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    issue_id UUID REFERENCES issues(id) ON DELETE CASCADE,
    sprint_id UUID REFERENCES sprints(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON tenant_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_user_status ON tenant_members(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tenant_members_tenant_joined_at ON tenant_members(tenant_id, joined_at);
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_github_installation_states_tenant_user ON github_installation_states(tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_github_installations_tenant ON github_installations(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_github_repositories_tenant_installation ON github_repositories(tenant_id, installation_id, status);
CREATE INDEX IF NOT EXISTS idx_project_repositories_tenant_project ON project_repositories(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_repositories_tenant_repo ON project_repositories(tenant_id, provider, repo);
CREATE INDEX IF NOT EXISTS idx_sprints_tenant_project ON sprints(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_sprints_tenant_project_status_start ON sprints(tenant_id, project_id, status, start_date);
CREATE INDEX IF NOT EXISTS idx_issues_tenant_project ON issues(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_issues_tenant_project_status_position ON issues(tenant_id, project_id, status, position);
CREATE INDEX IF NOT EXISTS idx_issues_repository ON issues(tenant_id, repository_id);
CREATE INDEX IF NOT EXISTS idx_issues_sprint ON issues(sprint_id);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_issues_agent_status ON issues(tenant_id, agent_status);
CREATE INDEX IF NOT EXISTS idx_issues_ai_pickable ON issues(tenant_id, ai_pickable, agent_status);
CREATE INDEX IF NOT EXISTS idx_comments_issue ON comments(issue_id);
CREATE INDEX IF NOT EXISTS idx_activity_tenant ON activity_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tokens_tenant ON agent_tokens(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_agent_repo_access_agent ON agent_repo_access(tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_repo_access_project ON agent_repo_access(tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_agent_claims_tenant_issue ON agent_claims(tenant_id, issue_id);
CREATE INDEX IF NOT EXISTS idx_external_links_issue ON external_links(issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_events_tenant_issue ON automation_events(tenant_id, issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_github_webhook_deliveries_event ON github_webhook_deliveries(event_type, created_at DESC);
