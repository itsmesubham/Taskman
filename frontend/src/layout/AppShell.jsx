import WorkspaceSidebar from './WorkspaceSidebar.jsx';
import Topbar from './Topbar.jsx';
import MobileBottomNav from './MobileBottomNav.jsx';
import WorkspaceGate from '../components/WorkspaceGate.jsx';
import IssueDrawer from '../components/IssueDrawer.jsx';
import Dashboard from '../screens/Dashboard.jsx';
import ProjectsPage from '../screens/ProjectsPage.jsx';
import BacklogPage from '../screens/BacklogPage.jsx';
import BoardPage from '../screens/BoardPage.jsx';
import SprintsPage from '../screens/SprintsPage.jsx';
import ReportsPage from '../screens/ReportsPage.jsx';
import AiPage from '../screens/AiPage.jsx';
import SettingsPage from '../screens/SettingsPage.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { cx } from '../utils.js';

export default function AppShell() {
  const {
    page,
    mobileNavOpen,
    setMobileNavOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    selectedIssue,
    toast
  } = useWorkspace();

  return (
    <div className="app-shell" style={{ '--sidebar-width': sidebarCollapsed ? '92px' : '280px' }}>
      <WorkspaceSidebar
        open={mobileNavOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setMobileNavOpen(false)}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      />

      <main className="main-area">
        <Topbar onMenu={() => setMobileNavOpen(true)} />
        <div className="content-wrap">
          <WorkspaceGate>
            {page === 'dashboard' && <Dashboard />}
            {page === 'projects' && <ProjectsPage />}
            {page === 'backlog' && <BacklogPage />}
            {page === 'board' && <BoardPage />}
            {page === 'sprints' && <SprintsPage />}
            {page === 'reports' && <ReportsPage />}
            {page === 'ai' && <AiPage />}
            {page === 'settings' && <SettingsPage />}
          </WorkspaceGate>
        </div>
      </main>

      <MobileBottomNav />
      {selectedIssue && <IssueDrawer />}
      {toast && <div className={cx('toast', toast.type)}>{toast.text}</div>}
    </div>
  );
}
