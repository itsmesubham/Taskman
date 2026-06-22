import { useEffect, useState } from 'react';
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

function inviteUrlFromPath(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${window.location.origin}${path}`;
}

export default function SettingsPage() {
  const { session, members, memberships, api, showError, showSuccess, loadWorkspace, setActiveTenant, createWorkspace, acceptInvite } = useWorkspace();
  const { themePreference, resolvedTheme, setThemePreference } = useTheme();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [loadingInvite, setLoadingInvite] = useState(false);
  const activeMembership = memberships.find((membership) => membership.tenant_id === session.tenant?.id) || memberships[0] || null;
  const currentRole = resolveCurrentWorkspaceRole({
    user: session.user,
    memberships,
    activeTenantId: session.tenant?.id
  });
  const isAdmin = currentRole === 'ADMIN';
  const isOwner = currentRole === 'OWNER';
  const canManageInvite = isAdmin || isOwner;
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
        if (!cancelled) setInviteLink(inviteUrlFromPath(result.invite_url));
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

  const addMember = async (event) => {
    event.preventDefault();
    try {
      await api.post(`/tenants/${session.tenant.id}/members`, { email, role });
      setEmail('');
      showSuccess('Member added');
      await loadWorkspace(true, true);
    } catch (error) { showError(error); }
  };

  const removeMember = async (member) => {
    if (!window.confirm(`Remove ${member.name} from this workspace?`)) return;
    try {
      await api.delete(`/tenants/${session.tenant.id}/members/${member.id}`);
      showSuccess('Member removed');
      await loadWorkspace(true, true);
    } catch (error) { showError(error); }
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
      setInviteLink(inviteUrlFromPath(result.invite_url));
      showSuccess('Invite link regenerated');
    } catch (error) { showError(error); }
  };

  const revokeInvite = async () => {
    try {
      const result = await api.post(`/tenants/${session.tenant.id}/invite-link/revoke`, {});
      setInviteLink(inviteUrlFromPath(result.invite_url));
      showSuccess('Invite link revoked');
    } catch (error) { showError(error); }
  };

  const createAnotherWorkspace = async (event) => {
    event.preventDefault();
    try {
      await createWorkspace({ name: workspaceName.trim(), ...(workspaceSlug.trim() ? { slug: workspaceSlug.trim() } : {}) });
    } catch (error) { showError(error); }
  };

  const joinWorkspace = async (event) => {
    event.preventDefault();
    try {
      const code = inviteInput.trim().replace(/^.*\/(?:invite|join)\//i, '').replace(/^\/+/, '');
      if (!code) throw new Error('Invite code is required');
      await acceptInvite(code);
    } catch (error) { showError(error); }
  };

  const switchWorkspace = async (tenantId) => {
    await setActiveTenant(tenantId);
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Workspace" title="Settings" description="Manage workspace access, invite links, members, and your current user context." />

      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <h3>Current workspace</h3>
          </div>
          <div className="detail-list">
            <span>Workspace</span><strong>{session.tenant?.name}</strong>
            <span>Slug</span><strong>{session.tenant?.slug}</strong>
            <span>User</span><strong>{session.user?.name}</strong>
            <span>Role</span><strong>{currentRole || 'MEMBER'}</strong>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Appearance</h3>
            <span>{resolvedTheme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
          </div>
          <p className="muted">Choose how Taskman looks on this device.</p>
          <div className="theme-choice-grid">
            {themeOptions.map((option) => (
              <button
                type="button"
                key={option.key}
                className={`theme-choice ${themePreference === option.key ? 'active' : ''}`}
                onClick={() => setThemePreference(option.key)}
              >
                <span className="theme-choice-icon">
                  <span className="theme-choice-ring" />
                </span>
                <div>
                  <strong>{option.label}</strong>
                  <span>{option.helper}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Workspace invite link</h3>
            <span>{loadingInvite ? 'Loading' : canManageInvite ? 'Manage' : 'Read only'}</span>
          </div>
          {canManageInvite ? (
            <>
              <div className="invite-preview">
                <strong>{inviteLink || 'Invite link unavailable'}</strong>
                <span>Anyone with this link can request to join this workspace as a member.</span>
              </div>
              <div className="form-actions">
                <button className="ghost" onClick={copyInvite} disabled={!inviteLink}>Copy link</button>
                <button className="ghost" onClick={regenerateInvite}>Regenerate</button>
                <button className="danger" onClick={revokeInvite}>Disable link</button>
              </div>
            </>
          ) : (
            <p className="muted">Invite link management is available to owners and admins.</p>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Members</h3>
          <span>{members.length}</span>
        </div>
        {isAdmin || isOwner ? (
          <form className="inline-controls wrap" onSubmit={addMember}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="existing.user@company.com" />
            <select value={role} onChange={(e) => setRole(e.target.value)}><option>ADMIN</option><option>MEMBER</option><option>VIEWER</option></select>
            <button className="primary">Add member</button>
          </form>
        ) : (
          <p className="muted">Member management is available to admins only.</p>
        )}
        <div className="member-grid">
          {members.map((member) => (
            <div className="member-card" key={member.id}>
              <div className="avatar">{initials(member.name)}</div>
              <div>
                <strong>{member.name}</strong>
                <span>{member.email}</span>
              </div>
              <em>{member.role}</em>
              {canManageInvite && member.id !== session.user?.id && (
                <button type="button" className="ghost tiny" onClick={() => removeMember(member)}>Remove</button>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <h3>Create another workspace</h3>
            <span>Optional</span>
          </div>
          <form className="form-stack" onSubmit={createAnotherWorkspace}>
            <label>
              Workspace name
              <input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="Grabbit" />
            </label>
            <label>
              Workspace slug or key
              <input value={workspaceSlug} onChange={(e) => setWorkspaceSlug(e.target.value)} placeholder="grabbit" />
            </label>
            <button className="primary">Create workspace</button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Join another workspace</h3>
            <span>Invite URL</span>
          </div>
          <form className="form-stack" onSubmit={joinWorkspace}>
            <label>
              Invite URL or code
              <input value={inviteInput} onChange={(e) => setInviteInput(e.target.value)} placeholder="https://taskman.fnetrix.com/invite/..." />
            </label>
            <button className="primary">Join workspace</button>
          </form>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Switch workspace</h3>
          <span>{memberships.length} available</span>
        </div>
        <div className="member-grid">
          {memberships.map((membership) => (
            <button key={membership.tenant_id} type="button" className="member-card" onClick={() => switchWorkspace(membership.tenant_id)}>
              <div className="avatar">{initials(membership.tenant_name)}</div>
              <div>
                <strong>{membership.tenant_name}</strong>
                <span>{membership.tenant_slug}</span>
              </div>
              <em>{membership.role}</em>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Keyboard shortcuts</h3>
          <span>Help</span>
        </div>
        <div className="shortcut-list">
          {SHORTCUTS.map((shortcut) => (
            <div className="shortcut-row" key={shortcut.keys}>
              <code>{shortcut.keys}</code>
              <span>{shortcut.action}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
