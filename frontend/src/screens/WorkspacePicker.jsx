import { useMemo, useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { initials } from '../utils.js';

export default function WorkspacePicker() {
  const { memberships, setActiveTenant } = useWorkspace();
  const [selected, setSelected] = useState(memberships[0]?.tenant_id || '');
  const current = useMemo(() => memberships.find((membership) => membership.tenant_id === selected) || memberships[0] || null, [memberships, selected]);

  const submit = async (event) => {
    event.preventDefault();
    if (!selected) return;
    await setActiveTenant(selected);
  };

  return (
    <div className="workspace-setup-screen">
      <section className="workspace-setup-card panel">
        <p className="eyebrow">TASKMAN FOR MODERN TEAMS</p>
        <h1>Choose workspace</h1>
        <p className="muted">Select the workspace you want to open.</p>

        <form className="workspace-picker-list" onSubmit={submit}>
          {memberships.map((membership) => (
            <label className={`workspace-picker-row ${selected === membership.tenant_id ? 'active' : ''}`} key={membership.tenant_id}>
              <input
                type="radio"
                name="workspace"
                value={membership.tenant_id}
                checked={selected === membership.tenant_id}
                onChange={() => setSelected(membership.tenant_id)}
              />
              <span className="avatar">{initials(membership.tenant_name || membership.tenant_slug || 'Workspace')}</span>
              <div>
                <strong>{membership.tenant_name}</strong>
                <span>{membership.role} · {membership.tenant_slug}</span>
              </div>
            </label>
          ))}

          {current && (
            <div className="invite-preview">
              <strong>{current.tenant_name}</strong>
              <span>{current.role}</span>
            </div>
          )}

          <button className="primary" disabled={!selected}>Continue</button>
        </form>
      </section>
    </div>
  );
}
