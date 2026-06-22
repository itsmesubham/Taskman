import { Sidebar as ProSidebar, Menu, MenuItem, sidebarClasses } from 'react-pro-sidebar';
import { NAV_ITEMS } from '../constants.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { initials } from '../utils.js';

export default function WorkspaceSidebar({ open, collapsed, onClose, onToggleCollapsed }) {
  const { page, setPage, session, logout } = useWorkspace();

  const menuItemStyles = {
    button: ({ active }) => ({
      backgroundColor: active ? 'rgba(59,130,246,.16)' : 'transparent',
      color: active ? '#ffffff' : '#cbd5e1',
      borderRadius: '14px',
      padding: '12px 14px',
      fontWeight: 800,
      border: active ? '1px solid rgba(96,165,250,.2)' : '1px solid transparent',
      boxShadow: active ? '0 10px 24px rgba(59,130,246,.14)' : 'none',
      '&:hover': { backgroundColor: 'rgba(255,255,255,.08)', color: '#fff' }
    }),
    icon: { color: '#7dd3fc' },
    label: { fontWeight: 800 }
  };

  return (
    <ProSidebar
      collapsed={collapsed}
      toggled={open}
      breakPoint="md"
      width="280px"
      collapsedWidth="92px"
      transitionDuration={220}
      onBackdropClick={onClose}
      rootStyles={{
        background: 'linear-gradient(180deg, #0b1220 0%, #111827 100%)',
        color: '#fff',
        borderRight: '1px solid rgba(148,163,184,.14)',
        height: '100vh',
        overflow: 'hidden',
        [`& .${sidebarClasses.container}`]: {
          background: 'linear-gradient(180deg, #0b1220 0%, #111827 100%)',
          color: '#fff'
        }
      }}
    >
      <div className="sidebar-shell">
        <div className="sidebar-brand">
          <div className="brand-mark small">T</div>
          {!collapsed && <div className="sidebar-brand-copy"><strong>Taskman</strong><span>{session.tenant?.name || 'Workspace'}</span></div>}
          <button type="button" className="icon-btn mobile-only sidebar-mobile-close" onClick={onClose}>×</button>
        </div>

        <Menu closeOnClick menuItemStyles={menuItemStyles} rootStyles={{ padding: '8px 10px 0', flex: 1, overflowY: 'auto', background: 'transparent' }}>
          {NAV_ITEMS.map(([key, label, icon]) => (
            <MenuItem key={key} active={page === key} icon={<span className="sidebar-menu-icon">{icon}</span>} onClick={() => { setPage(key); onClose?.(); }}>
              {label}
            </MenuItem>
          ))}
        </Menu>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="avatar">{initials(session.user?.name)}</div>
            {!collapsed && <div className="user-chip-copy"><strong>{session.user?.name}</strong><span>{session.user?.role}</span></div>}
          </div>
          <div className="sidebar-footer-actions">
            <button type="button" className="ghost full desktop-only" onClick={onToggleCollapsed}>{collapsed ? '»' : '«'} {!collapsed && 'Collapse'}</button>
            <button type="button" className="ghost full" onClick={logout}>Logout</button>
          </div>
        </div>
      </div>
    </ProSidebar>
  );
}
