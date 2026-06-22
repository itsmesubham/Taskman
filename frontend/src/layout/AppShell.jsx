import { useEffect, useState } from 'react';
import TopNav from './TopNav.jsx';
import WorkspaceGate from '../components/WorkspaceGate.jsx';
import TaskDetailDrawer from '../components/TaskDetailDrawer.jsx';
import CommandMenu from '../components/CommandMenu.jsx';
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
    selectedIssue,
    toast,
    openCreateTaskDrawer,
    setPage,
    moveIssueStatus,
    setBoardSprintId
  } = useWorkspace();
  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        openCreateTaskDrawer('TODO');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openCreateTaskDrawer]);

  const handleCommand = (commandId) => {
    switch (commandId) {
      case 'create-task':
        openCreateTaskDrawer('TODO');
        break;
      case 'search-task':
        document.querySelector('.global-search input')?.focus();
        break;
      case 'open-board':
        setPage('board');
        break;
      case 'open-backlog':
        setPage('backlog');
        break;
      case 'open-my-tasks':
        setPage('my-tasks');
        break;
      case 'open-projects':
        setPage('projects');
        break;
      case 'open-sprints':
        setPage('sprints');
        break;
      case 'open-reports':
        setPage('reports');
        break;
      case 'open-current-sprint':
        setPage('board');
        setBoardSprintId('active');
        break;
      case 'create-sprint':
        setPage('sprints');
        break;
      case 'move-todo':
        if (selectedIssue) moveIssueStatus(selectedIssue.id, 'TODO');
        break;
      case 'move-progress':
        if (selectedIssue) moveIssueStatus(selectedIssue.id, 'IN_PROGRESS');
        break;
      case 'move-review':
        if (selectedIssue) moveIssueStatus(selectedIssue.id, 'IN_REVIEW');
        break;
      case 'move-done':
        if (selectedIssue) moveIssueStatus(selectedIssue.id, 'DONE');
        break;
      case 'assign-task':
      case 'change-priority':
        if (selectedIssue) setPage('board');
        break;
      default:
        break;
    }
  };

  return (
    <div className="app-shell">
      <TopNav />
      <main className="main-area">
        <div className="content-wrap">
          <WorkspaceGate>
            {page === 'dashboard' && <Dashboard />}
            {page === 'projects' && <ProjectsPage />}
            {(page === 'backlog' || page === 'my-tasks') && <BacklogPage />}
            {page === 'board' && <BoardPage />}
            {page === 'sprints' && <SprintsPage />}
            {page === 'reports' && <ReportsPage />}
            {page === 'ai' && <AiPage />}
            {page === 'settings' && <SettingsPage />}
          </WorkspaceGate>
        </div>
      </main>
      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} onAction={handleCommand} selectedIssue={selectedIssue} />
      {selectedIssue && <TaskDetailDrawer />}
      {toast && <div className={cx('toast', toast.type)}>{toast.text}</div>}
    </div>
  );
}
