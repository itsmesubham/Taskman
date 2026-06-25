import { useMemo, useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { extractInviteCode } from '../utils/invite.js';

export default function TenantOnboarding() {
  const { createWorkspace, api, acceptInvite, navigate, logout } = useWorkspace();
  const [mode, setMode] = useState('create');
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [inviteValue, setInviteValue] = useState('');
  const [invitePreview, setInvitePreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const inviteCode = useMemo(() => extractInviteCode(inviteValue), [inviteValue]);

  const createSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await createWorkspace({ name: workspaceName.trim(), ...(workspaceSlug.trim() ? { slug: workspaceSlug.trim() } : {}) });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const previewInvite = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await api.get(`/invites/${inviteCode}`);
      setInvitePreview(result);
    } catch (err) {
      setInvitePreview(null);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const joinSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await acceptInvite(inviteCode);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="workspace-setup-screen">
      <section className="workspace-setup-card panel">
        <div className="workspace-setup-header">
          <div>
            <p className="eyebrow">TASKMAN FOR MODERN TEAMS</p>
            <h1>Set up your workspace</h1>
            <p className="muted">Create a workspace or join your team with an invite link.</p>
          </div>
          <div className="workspace-setup-actions">
            <button type="button" className="ghost" onClick={logout}>Logout</button>
          </div>
        </div>

        <div className="setup-switcher">
          <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>Create workspace</button>
          <button type="button" className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>Join with invite link</button>
        </div>

        {mode === 'create' ? (
          <form className="form-stack" onSubmit={createSubmit}>
            <label>
              Workspace name
              <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="Grabbit" required autoFocus />
            </label>
            <label>
              Workspace slug or key
              <input value={workspaceSlug} onChange={(event) => setWorkspaceSlug(event.target.value)} placeholder="grabbit" />
            </label>
            {error && <div className="inline-error">{error}</div>}
            <button className="primary" disabled={busy}>{busy ? 'Creating...' : 'Create workspace'}</button>
          </form>
        ) : (
          <form className="form-stack" onSubmit={invitePreview ? joinSubmit : previewInvite}>
            <label>
              Invite URL or code
              <input
                value={inviteValue}
                onChange={(event) => {
                  setInviteValue(event.target.value);
                  setInvitePreview(null);
                }}
                placeholder="https://taskman.fnetrix.com/invite/..."
                autoFocus
              />
            </label>
            {invitePreview && (
              <div className="invite-preview">
                <strong>{invitePreview.workspace_name}</strong>
                <span>Role: {invitePreview.role || 'MEMBER'}</span>
              </div>
            )}
            {error && <div className="inline-error">{error}</div>}
            <div className="form-actions">
              <button className="primary" disabled={busy}>{busy ? 'Please wait...' : invitePreview ? 'Join workspace' : 'Continue'}</button>
              <button type="button" className="ghost" onClick={() => navigate('/')}>Cancel</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
