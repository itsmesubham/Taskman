import { useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { cx, initials } from '../utils.js';

export default function WorkspaceSwitcher() {
  const { session, memberships, setActiveTenant } = useWorkspace();
  const [open, setOpen] = useState(false);
  const activeLabel = session.tenant?.name || memberships[0]?.tenant_name || 'Workspace';
  const activeSlug = session.tenant?.slug || memberships[0]?.tenant_slug || '';

  const selectWorkspace = async (tenantId) => {
    setOpen(false);
    if (!tenantId) return;
    await setActiveTenant(tenantId);
  };

  return (
    <div className="workspace-switcher workspace-switcher-menu">
      <button
        type="button"
        className="workspace-switcher-trigger"
        onClick={memberships.length > 1 ? () => setOpen((current) => !current) : undefined}
      >
        <div className="brand-mark small">T</div>
        <div className="workspace-switcher-copy">
          <strong>{activeLabel}</strong>
          <span>{activeSlug || 'Workspace'}</span>
        </div>
        {memberships.length > 1 && <span className="workspace-switcher-caret">▾</span>}
      </button>

      {open && memberships.length > 1 && (
        <div className="workspace-switcher-menu-panel">
          {memberships.map((membership) => (
            <button
              key={membership.tenant_id}
              type="button"
              className={cx('workspace-switcher-item', session.tenant?.id === membership.tenant_id && 'active')}
              onClick={() => selectWorkspace(membership.tenant_id)}
            >
              <span className="avatar">{initials(membership.tenant_name)}</span>
              <div>
                <strong>{membership.tenant_name}</strong>
                <span>{membership.role}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
