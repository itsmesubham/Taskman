import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { resolveCurrentWorkspaceRole } from '../utils/workspaceSession.js';
import { initials } from '../utils.js';

const SHORTCUTS = [
  { keys: 'C', action: 'Create task' },
  { keys: 'Cmd / Ctrl + K', action: 'Open command menu' },
  { keys: 'Esc', action: 'Close drawers and dialogs' },
  { keys: 'Enter', action: 'Submit a valid task form' },
  { keys: 'Tab', action: 'Move through fields' }
];

const SETTINGS_TABS = [
  { key: 'general', label: 'General' },
  { key: 'members', label: 'Members' },
  { key: 'invites', label: 'Invites' },
  { key: 'agents', label: 'Agents' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'shortcuts', label: 'Shortcuts' }
];

function normalizeInviteUrl(path) {
  if (!path) return '';
  try {
    const url = new URL(path, window.location.origin);
    const localOrigin = /localhost|127\.0\.0\.1/.test(url.host);
    const currentLocal = /localhost|127\.0\.0\.1/.test(window.location.hostname);
    if (localOrigin && !currentLocal) {
      return new URL(`${url.pathname}${url.search}${url.hash}`, window.location.origin).toString();
    }
    return url.toString();
  } catch {
    if (path.startsWith('http')) return path;
    return `${window.location.origin}${path}`;
  }
}

function SettingsDialog({ open, title, description, onClose, children, wide = false }) {
  if (!open) return null;
  return (
    <div className="settings-dialog-backdrop" onMouseDown={onClose}>
      <aside
        className={`settings-dialog ${wide ? 'wide' : ''}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>{title}</h2>
            {description ? <p className="drawer-helper">{description}</p> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>×</button>
        </div>
        {children}
      </aside>
    </div>
  );
}

export default function SettingsPage() {
  const {
    session,
    members,
    memberships,
    projects,
    projectRepositories,
    api,
    showError,
    showSuccess,
    loadWorkspace,
    setActiveTenant,
    createWorkspace,
    acceptInvite
  } = useWorkspace();
  const { themePreference, resolvedTheme, setThemePreference } = useTheme();

  const [activeSection, setActiveSection] = useState('general');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [switchWorkspaceOpen, setSwitchWorkspaceOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [agentTokenName, setAgentTokenName] = useState('');
  const [agentTokens, setAgentTokens] = useState([]);
  const [selectedRepoIds, setSelectedRepoIds] = useState({});
  const [loadingTokens, setLoadingTokens] = useState(false);

  const activeMembership = memberships.find((membership) => membership.tenant_id === session.tenant?.id) || memberships[0] || null;
  const currentRole = resolveCurrentWorkspaceRole({
    user: session.user,
    memberships,
    activeTenantId: session.tenant?.id
  });
  const isAdmin = currentRole === 'ADMIN';
  const isOwner = currentRole === 'OWNER';
  const canManageInvite = isAdmin || isOwner;
  const canManageMembers = isAdmin || isOwner;

  const projectRepoGroups = useMemo(() => projects.map((project) => ({
    ...project,
    repositories: projectRepositories.filter((repository) => repository.project_id === project.id)
  })), [projectRepositories, projects]);

  const activeWorkspace = useMemo(() => ({
    name: session.tenant?.name || 'Workspace',
    slug: session.tenant?.slug || '',
    id: session.tenant?.id || '',
    user: session.user?.name || 'User',
    role: currentRole || 'MEMBER',
    membership: activeMembership
  }), [activeMembership, currentRole, session.tenant?.id, session.tenant?.name, session.tenant?.slug, session.user?.name]);

  const themeOptions = [
    { key: 'system', label: 'System', helper: 'Follow device setting' },
    { key: 'light', label: 'Light', helper: 'Bright workspace' },
    { key: 'dark', label: 'Dark', helper: 'Low-light workspace' }
  ];

  useEffect(() => {
    let cancelled = false;
    const loadInvite = async () => {
      if (!session.tenant?.id || !canManageInvite) {
        setInviteLink('');
        setLoadingInvite(false);
        return;
      }
      setLoadingInvite(true);
      try {
        const result = await api.get(`/tenants/${session.tenant.id}/invite-link`);
        if (!cancelled) setInviteLink(normalizeInviteUrl(result.invite_url));
      } catch (error) {
        if (!cancelled) {
          setInviteLink('');
          showError(error);
        }
      } finally {
        if (!cancelled) setLoadingInvite(false);
      }
    };
    loadInvite();
    return () => { cancelled = true; };
  }, [api, canManageInvite, session.tenant?.id, showError]);

  useEffect(() => {
    let cancelled = false;
    const loadAgentTokens = async () => {
      if (!session.tenant?.id || !(isAdmin || isOwner)) {
        setAgentTokens([]);
        return;
      }
      setLoadingTokens(true);
      try {
        const result = await api.get('/agent/tokens');
        if (!cancelled) setAgentTokens(result.tokens || []);
      } catch (error) {
        if (!cancelled) {
          setAgentTokens([]);
          showError(error);
        }
      } finally {
        if (!cancelled) setLoadingTokens(false);
      }
    };
    loadAgentTokens();
    return () => { cancelled = true; };
  }, [api, isAdmin, isOwner, session.tenant?.id, showError]);

  const addMember = async (event) => {
    event.preventDefault();
    try {
      await api.post(`/tenants/${session.tenant.id}/members`, { email, role });
      setEmail('');
      setRole('MEMBER');
      setAddMemberOpen(false);
      showSuccess('Member added');
      await loadWorkspace(true, true);
    } catch (error) {
      showError(error);
    }
  };

  const removeMember = async (member) => {
    if (!window.confirm(`Remove ${member.name} from this workspace?`)) return;
    try {
      await api.delete(`/tenants/${session.tenant.id}/members/${member.id}`);
      showSuccess('Member removed');
      await loadWorkspace(true, true);
    } catch (error) {
      showError(error);
    }
  };

  const copyEmail = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess('Email copied');
    } catch {
      showError(new Error('Unable to copy email'));
    }
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      showSuccess('Invite link copied');
    } catch {
      showError(new Error('Unable to copy invite link'));
    }
  };

  const regenerateInvite = async () => {
    try {
      const result = await api.post(`/tenants/${session.tenant.id}/invite-link/regenerate`, {});
      setInviteLink(normalizeInviteUrl(result.invite_url));
      showSuccess('Invite link regenerated');
    } catch (error) {
      showError(error);
    }
  };

  const revokeInvite = async () => {
    try {
      const result = await api.post(`/tenants/${session.tenant.id}/invite-link/revoke`, {});
      setInviteLink(normalizeInviteUrl(result.invite_url));
      showSuccess('Invite link disabled');
    } catch (error) {
      showError(error);
    }
  };

  const createAnotherWorkspace = async (event) => {
    event.preventDefault();
    try {
      await createWorkspace({ name: workspaceName.trim(), ...(workspaceSlug.trim() ? { slug: workspaceSlug.trim() } : {}) });
      setWorkspaceName('');
      setWorkspaceSlug('');
      setCreateWorkspaceOpen(false);
    } catch (error) {
      showError(error);
    }
  };

  const joinWorkspace = async (event) => {
    event.preventDefault();
    try {
      const code = inviteInput.trim().replace(/^.*\/(?:invite|join)\//i, '').replace(/^\/+/, '');
      if (!code) throw new Error('Invite code is required');
      await acceptInvite(code);
    } catch (error) {
      showError(error);
    }
  };

  const switchWorkspace = async (tenantId) => {
    await setActiveTenant(tenantId);
  };

  const toggleRepo = (repoId, checked) => {
    setSelectedRepoIds((current) => ({ ...current, [repoId]: checked }));
  };

  const toggleProjectRepos = (projectId, checked) => {
    const repositoryIds = projectRepoGroups.find((group) => group.id === projectId)?.repositories?.map((repository) => repository.id) || [];
    setSelectedRepoIds((current) => {
      const next = { ...current };
      repositoryIds.forEach((repoId) => {
        next[repoId] = checked;
      });
      return next;
    });
  };

  const createAgentToken = async (event) => {
    event.preventDefault();
    try {
      const project_repository_ids = Object.entries(selectedRepoIds).filter(([, enabled]) => enabled).map(([repoId]) => repoId);
      const result = await api.post('/agent/tokens', {
        name: agentTokenName.trim(),
        project_repository_ids
      });
      setAgentTokenName('');
      setSelectedRepoIds({});
      setCreateAgentOpen(false);
      showSuccess('Agent token created');
      setAgentTokens((current) => [result.token, ...current]);
    } catch (error) {
      showError(error);
    }
  };

  const copyWorkspaceId = async () => {
    if (!activeWorkspace.id) return;
    try {
      await navigator.clipboard.writeText(activeWorkspace.id);
      showSuccess('Workspace ID copied');
    } catch {
      showError(new Error('Unable to copy workspace ID'));
    }
  };

  const renderGeneralSection = () => (
    <article className="settings-card settings-form-card settings-general-card">
      <section className="settings-form-section">
        <div className="settings-profile-head">
          <div>
            <p className="eyebrow">General</p>
            <h3>Workspace profile</h3>
            <p>Basic identity for this workspace.</p>
          </div>
          <div className="settings-profile-meta">
            <div className="workspace-avatar small">{initials(activeWorkspace.name)}</div>
            <span className={`role-badge ${activeWorkspace.role === 'OWNER' ? '' : 'subtle'}`}>{activeWorkspace.role}</span>
          </div>
        </div>
        <div className="settings-row-list">
          <div className="settings-row form-row">
            <span>Name</span>
            <strong>{activeWorkspace.name}</strong>
          </div>
          <div className="settings-row form-row">
            <span>Slug / key</span>
            <strong>{activeWorkspace.slug || '—'}</strong>
          </div>
        </div>
      </section>

      <section className="settings-form-section">
        <div className="settings-form-section-head">
          <div>
            <h3>Workspace details</h3>
            <p>Current user context and workspace identifiers.</p>
          </div>
        </div>
        <div className="settings-row-list">
          <div className="settings-row form-row">
            <span>Current user</span>
            <strong>{activeWorkspace.user}</strong>
          </div>
          <div className="settings-row form-row">
            <span>Role</span>
            <strong><span className={`role-badge ${activeWorkspace.role === 'OWNER' ? '' : 'subtle'}`}>{activeWorkspace.role}</span></strong>
          </div>
          <div className="settings-row form-row">
            <span>Workspace ID</span>
            <strong className="inline-row">
              <code>{activeWorkspace.id ? `•••${activeWorkspace.id.slice(-8)}` : '—'}</code>
              <button type="button" className="ghost tiny" onClick={copyWorkspaceId} disabled={!activeWorkspace.id}>Copy workspace ID</button>
            </strong>
          </div>
        </div>
      </section>

      <section className="settings-form-section">
        <div className="settings-form-section-head">
          <div>
            <h3>Workspace management</h3>
            <p>Switch or create workspaces when needed.</p>
          </div>
        </div>
        <div className="settings-row-list">
          <div className="settings-row action-row">
            <div>
              <span>Switch workspace</span>
              <small>Change your active workspace.</small>
            </div>
            {memberships.length > 1 ? (
              <button type="button" className="ghost tiny" onClick={() => setSwitchWorkspaceOpen(true)}>Switch</button>
            ) : (
              <span className="muted">You are already in the only available workspace.</span>
            )}
          </div>
          <div className="settings-row action-row">
            <div>
              <span>Create workspace</span>
              <small>Start a new workspace.</small>
            </div>
            <button type="button" className="ghost tiny" onClick={() => setCreateWorkspaceOpen(true)}>Create</button>
          </div>
          <div className="settings-row action-row">
            <div>
              <span>Manage members</span>
              <small>Add or remove workspace members.</small>
            </div>
            <button type="button" className="ghost tiny" onClick={() => setActiveSection('members')}>Open</button>
          </div>
        </div>
      </section>
    </article>
  );

  const renderMembersSection = () => (
    <article className="settings-card">
      <div className="section-header">
        <div>
          <h3>Members</h3>
          <p>Manage people who can access this workspace.</p>
        </div>
        <div className="section-header-meta">
          <span className="status-pill">{members.length} members</span>
          {canManageMembers ? (
            <button type="button" className="primary" onClick={() => setAddMemberOpen(true)}>
              Add member
            </button>
          ) : (
            <span className="status-pill">Read only</span>
          )}
        </div>
      </div>

      <div className="member-table">
        {members.map((member) => {
          const isCurrentUser = member.id === session.user?.id;
          const isOwnerRow = String(member.role || '').toUpperCase() === 'OWNER';
          return (
            <div className="member-row" key={member.id}>
              <div className="member-row-main">
                <div className="member-avatar">{initials(member.name)}</div>
                <div className="member-copy">
                  <strong>{member.name}</strong>
                  <span>{member.email}</span>
                </div>
              </div>
              <div className="member-row-meta">
                <span className={`role-badge ${String(member.role || '').toLowerCase()}`}>{member.role}</span>
              </div>
              <div className="member-row-actions">
                <button type="button" className="ghost tiny" onClick={() => copyEmail(member.email)}>Copy email</button>
                {!isOwnerRow && !isCurrentUser && (
                  <button type="button" className="danger tiny" onClick={() => removeMember(member)}>Remove</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );

  const renderInvitesSection = () => (
    <article className="settings-card">
      <div className="section-header">
        <div>
          <h3>Invites</h3>
          <p>Control the workspace invite link for new members.</p>
        </div>
        <span className={`status-pill ${inviteLink ? 'done' : 'blocked'}`}>{loadingInvite ? 'Loading' : inviteLink ? 'Enabled' : 'Disabled'}</span>
      </div>

      <div className="settings-form-section">
        <div className="settings-row-grid">
          <div className="settings-row wide">
            <span>Invite URL</span>
            <strong className="inline-row">
              <input readOnly value={inviteLink || 'Invite link disabled'} aria-label="Workspace invite link" />
              <button type="button" className="ghost tiny" onClick={copyInvite} disabled={!inviteLink}>Copy link</button>
            </strong>
          </div>
        </div>
        <div className="settings-action-row">
          {canManageInvite ? (
            <>
              <button type="button" className="ghost" onClick={regenerateInvite}>{inviteLink ? 'Regenerate' : 'Enable link'}</button>
              <button type="button" className="danger" onClick={revokeInvite} disabled={!inviteLink}>Disable link</button>
            </>
          ) : (
            <span className="muted">Invite link management is available to owners and admins.</span>
          )}
        </div>
      </div>
    </article>
  );

  const renderAppearanceSection = () => (
    <article className="settings-card">
      <div className="section-header">
        <div>
          <h3>Appearance</h3>
          <p>Choose how Taskman looks on this device.</p>
        </div>
        <span className="status-pill">{resolvedTheme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
      </div>
      <div className="appearance-grid">
        {themeOptions.map((option) => (
          <button
            type="button"
            key={option.key}
            className={`appearance-card ${themePreference === option.key ? 'active' : ''}`}
            onClick={() => setThemePreference(option.key)}
          >
            <div className="appearance-preview">
              <span />
              <span />
              <span />
            </div>
            <div className="appearance-copy">
              <strong>{option.label}</strong>
              <span>{option.helper}</span>
            </div>
          </button>
        ))}
      </div>
    </article>
  );

  const renderAgentsSection = () => (
    <article className="settings-card">
      <div className="section-header">
        <div>
          <h3>Agents</h3>
          <p>Create scoped MCP agents that can pick tasks, attach PRs, and update status.</p>
        </div>
        <button type="button" className="primary" onClick={() => setCreateAgentOpen(true)}>Create agent</button>
      </div>
      {agentTokens.length ? (
        <div className="agent-token-list compact">
          {agentTokens.map((token) => (
            <article className="agent-token-card" key={token.id}>
              <div className="agent-token-head">
                <div>
                  <strong>{token.name}</strong>
                  <span>{token.active ? 'Active' : 'Disabled'}</span>
                </div>
                <code>{token.allowed_repo || `tok_${String(token.id).slice(-8)}`}</code>
              </div>
              <div className="agent-token-projects">
                {(token.repository_access || []).length ? (
                  token.repository_access.reduce((groups, access) => {
                    const bucket = groups.find((item) => item.project_id === access.project_id) || null;
                    if (bucket) {
                      bucket.repositories.push(access);
                      return groups;
                    }
                    groups.push({ project_id: access.project_id, project_name: access.project_name, project_key: access.project_key, repositories: [access] });
                    return groups;
                  }, []).map((group) => (
                    <div className="agent-token-project" key={group.project_id}>
                      <strong>{group.project_name}</strong>
                      <span>{group.project_key}</span>
                      <small>{group.repositories.map((repository) => repository.repo).join(', ')}</small>
                    </div>
                  ))
                ) : (
                  <span className="muted">No repository access configured.</span>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">
          <h4>No agents yet</h4>
          <p>Create a scoped token for Codex, Claude Code, Cursor, or another MCP-compatible agent.</p>
          <button type="button" className="primary" onClick={() => setCreateAgentOpen(true)}>Create agent</button>
        </div>
      )}
    </article>
  );

  const renderShortcutsSection = () => (
    <article className="settings-card">
      <div className="section-header">
        <div>
          <h3>Shortcuts</h3>
          <p>Fast paths for common actions.</p>
        </div>
      </div>
      <div className="shortcut-table compact">
        {SHORTCUTS.map((shortcut) => (
          <div className="shortcut-row compact" key={shortcut.keys}>
            <code>{shortcut.keys}</code>
            <span>{shortcut.action}</span>
          </div>
        ))}
      </div>
    </article>
  );

  const renderSection = () => {
    switch (activeSection) {
      case 'members':
        return renderMembersSection();
      case 'invites':
        return renderInvitesSection();
      case 'agents':
        return renderAgentsSection();
      case 'appearance':
        return renderAppearanceSection();
      case 'shortcuts':
        return renderShortcutsSection();
      case 'general':
      default:
        return renderGeneralSection();
    }
  };

  return (
    <div className="page-stack settings-page">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Manage workspace access, invite links, agents, and appearance."
        action={(
          <div className="settings-header-meta">
            <span className="status-pill">{activeWorkspace.role}</span>
            <span className="issue-meta-badge muted">{activeWorkspace.slug || 'workspace'}</span>
          </div>
        )}
      />

      <div className="settings-center">
        <div className="settings-tab-bar">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`settings-tab ${activeSection === tab.key ? 'active' : ''}`}
              onClick={() => setActiveSection(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="settings-content">
          {renderSection()}
        </div>
      </div>

      <SettingsDialog
        open={createWorkspaceOpen}
        title="Create workspace"
        description="Start a new workspace with a concise name and slug."
        onClose={() => setCreateWorkspaceOpen(false)}
      >
        <form className="settings-form modal-form" onSubmit={createAnotherWorkspace}>
          <label>
            Workspace name
            <input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="Grabbit" />
          </label>
          <label>
            Workspace slug or key
            <input value={workspaceSlug} onChange={(e) => setWorkspaceSlug(e.target.value)} placeholder="grabbit" />
          </label>
          <div className="settings-modal-actions">
            <button type="button" className="ghost" onClick={() => setCreateWorkspaceOpen(false)}>Cancel</button>
            <button className="primary">Create workspace</button>
          </div>
        </form>
      </SettingsDialog>

      <SettingsDialog
        open={switchWorkspaceOpen}
        title="Switch workspace"
        description="Choose another workspace you belong to."
        onClose={() => setSwitchWorkspaceOpen(false)}
      >
        <div className="workspace-switch-list modal-list">
          {memberships.length ? memberships.map((membership) => {
            const isCurrent = membership.tenant_id === session.tenant?.id;
            return (
              <div key={membership.tenant_id} className="workspace-switch-item">
                <div className="workspace-switch-avatar">{initials(membership.tenant_name)}</div>
                <div className="workspace-switch-copy">
                  <strong>{membership.tenant_name}</strong>
                  <span>{membership.tenant_slug}</span>
                </div>
                <span className={`role-badge ${isCurrent ? '' : 'subtle'}`}>{isCurrent ? 'Active' : membership.role}</span>
                {!isCurrent && <button type="button" className="ghost tiny" onClick={() => { switchWorkspace(membership.tenant_id); setSwitchWorkspaceOpen(false); }}>Switch</button>}
              </div>
            );
          }) : <div className="empty-inline">You are currently in this workspace.</div>}
        </div>
      </SettingsDialog>

      <SettingsDialog
        open={addMemberOpen}
        title="Add member"
        description="Invite someone into the current workspace."
        onClose={() => setAddMemberOpen(false)}
      >
        <form className="settings-form modal-form" onSubmit={addMember}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="existing.user@company.com" required />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option>ADMIN</option>
              <option>MEMBER</option>
              <option>VIEWER</option>
            </select>
          </label>
          <div className="settings-modal-actions">
            <button type="button" className="ghost" onClick={() => setAddMemberOpen(false)}>Cancel</button>
            <button className="primary">Send invite</button>
          </div>
        </form>
      </SettingsDialog>

      <SettingsDialog
        open={createAgentOpen}
        title="Create agent token"
        description="Scope each token to selected projects and repositories."
        onClose={() => setCreateAgentOpen(false)}
        wide
      >
        <form className="settings-form modal-form" onSubmit={createAgentToken}>
          <label className="wide">
            Token name
            <input value={agentTokenName} onChange={(event) => setAgentTokenName(event.target.value)} placeholder="Codex Agent" required />
          </label>
          <div className="agent-project-grid modal-grid">
            {projectRepoGroups.map((project) => {
              const selectedCount = project.repositories.filter((repository) => selectedRepoIds[repository.id]).length;
              const allSelected = project.repositories.length > 0 && selectedCount === project.repositories.length;
              return (
                <article key={project.id} className="agent-project-card">
                  <div className="agent-project-head">
                    <div>
                      <strong>{project.name}</strong>
                      <span>{project.key} · {project.repositories.length} repos</span>
                    </div>
                    <label className="toggle-row compact">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(event) => toggleProjectRepos(project.id, event.target.checked)}
                      />
                      <span>
                        All repos
                        <small>{selectedCount} selected</small>
                      </span>
                    </label>
                  </div>
                  <div className="repo-checklist">
                    {project.repositories.map((repository) => (
                      <label key={repository.id} className="repo-check">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedRepoIds[repository.id])}
                          onChange={(event) => toggleRepo(repository.id, event.target.checked)}
                        />
                        <span>
                          <strong>{repository.repo}</strong>
                          <small>{repository.default_branch} · {repository.branch_prefix || 'no prefix'}</small>
                        </span>
                      </label>
                    ))}
                    {!project.repositories.length && <div className="muted">No repositories linked yet.</div>}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="settings-modal-actions">
            <button type="button" className="ghost" onClick={() => setCreateAgentOpen(false)}>Cancel</button>
            <button type="submit" className="primary">Create agent token</button>
          </div>
        </form>
      </SettingsDialog>
    </div>
  );
}
