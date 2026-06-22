import { useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { DEFAULT_API_BASE, isSecureApiBase, normalizeApiBase } from '../api/client.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { initials } from '../utils.js';

const SHORTCUTS = [
  { keys: 'C', action: 'Create task' },
  { keys: 'Cmd / Ctrl + K', action: 'Open command menu' },
  { keys: 'Esc', action: 'Close drawers and dialogs' },
  { keys: 'Enter', action: 'Submit a valid task form' },
  { keys: 'Tab', action: 'Move through fields' }
];

export default function SettingsPage() {
  const { session, updateSession, members, api, showError, showSuccess, loadWorkspace } = useWorkspace();
  const [apiBase, setApiBase] = useState(session.apiBase || DEFAULT_API_BASE);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('MEMBER');
  const isAdmin = String(session.user?.role || '').toUpperCase() === 'ADMIN';

  const saveApi = () => {
    if (!isSecureApiBase(apiBase)) { showError(new Error('Backend API URL must use HTTPS unless it is localhost.')); return; }
    updateSession({ ...session, apiBase: normalizeApiBase(apiBase) });
    showSuccess('API URL saved');
  };

  const addMember = async (event) => {
    event.preventDefault();
    try {
      await api.post(`/tenants/${session.tenant.id}/members`, { email, role });
      setEmail('');
      showSuccess('Member added');
      await loadWorkspace(true);
    } catch (error) { showError(error); }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Administration" title="Settings" description="Manage API connection, tenant members, and current user context." />
      <div className="two-col">
        <section className="panel"><div className="panel-head"><h3>Workspace</h3></div><div className="detail-list"><span>Tenant</span><strong>{session.tenant?.name}</strong><span>Slug</span><strong>{session.tenant?.slug}</strong><span>User</span><strong>{session.user?.name}</strong><span>Role</span><strong>{session.user?.role}</strong></div></section>
        {isAdmin && (
          <section className="panel">
            <div className="panel-head">
              <h3>API connection</h3>
            </div>
            <label>
              Backend API URL
              <input
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
              />
            </label>
            <button className="primary" onClick={saveApi}>Save API URL</button>
          </section>
        )}
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Members</h3>
          <span>{members.length}</span>
        </div>
        {isAdmin ? (
          <form className="inline-controls wrap" onSubmit={addMember}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="existing.user@company.com" />
            <select value={role} onChange={(e) => setRole(e.target.value)}><option>ADMIN</option><option>MEMBER</option><option>VIEWER</option></select>
            <button className="primary">Add member</button>
          </form>
        ) : (
          <p className="muted">Member management is available to admins only.</p>
        )}
        <div className="member-grid">{members.map((member) => <div className="member-card" key={member.id}><div className="avatar">{initials(member.name)}</div><div><strong>{member.name}</strong><span>{member.email}</span></div><em>{member.role}</em></div>)}</div>
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
