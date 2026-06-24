import { MOBILE_NAV_ITEMS, MAIN_NAV_ITEMS } from '../constants.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { cx } from '../utils.js';
import NavLink from './NavLink.jsx';
import WorkspaceSwitcher from './WorkspaceSwitcher.jsx';
import UserMenu from './UserMenu.jsx';

export default function TopNav() {
  const {
    page,
    setPage,
    mobileNavOpen,
    setMobileNavOpen,
    query,
    setQuery,
    eventStatus,
    session
  } = useWorkspace();

  return (
    <>
      <header className="topnav">
        <div className="topnav-left">
          <button type="button" className="icon-btn mobile-only" onClick={() => setMobileNavOpen((current) => !current)}>
            ☰
          </button>
          <WorkspaceSwitcher />
        </div>

        <nav className="topnav-nav desktop-only" aria-label="Main navigation">
          {MAIN_NAV_ITEMS.map(([key, label]) => (
            <NavLink key={key} active={page === key} onClick={() => setPage(key)}>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="topnav-right">
          <div className="global-search">
            <span>⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks, people, PRs" />
          </div>
          <span className={cx('realtime-pill', eventStatus)}>{eventStatus}</span>
          <UserMenu />
        </div>
      </header>

      {mobileNavOpen && (
        <div className="mobile-nav-backdrop" onMouseDown={() => setMobileNavOpen(false)}>
          <div className="mobile-nav-panel" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mobile-nav-head">
              <div className="workspace-switcher compact">
                <div className="brand-mark small">T</div>
                <div className="workspace-switcher-copy">
                  <strong>Taskman</strong>
                  <span>{session.tenant?.name || 'Workspace'}</span>
                </div>
              </div>
              <button type="button" className="icon-btn" onClick={() => setMobileNavOpen(false)}>×</button>
            </div>
            <div className="mobile-nav-links">
              {MOBILE_NAV_ITEMS.map(([key, label]) => (
                <NavLink key={key} active={page === key} onClick={() => { setPage(key); setMobileNavOpen(false); }}>
                  {label}
                </NavLink>
              ))}
            </div>
            <div className="mobile-nav-actions">
              <button type="button" className="ghost full" onClick={() => { setPage('settings'); setMobileNavOpen(false); }}>Settings</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
