import EmptyState from './EmptyState.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';

export default function WorkspaceGate({ children }) {
  const { projects, page, setPage } = useWorkspace();
  if (projects.length || page === 'projects' || page === 'settings') return children;
  return (
    <EmptyState
      title="Create your first project"
      text="Projects organize backlog, sprints, board, reports, and delivery activity for a tenant."
      action={<button className="primary" onClick={() => setPage('projects')}>Create project</button>}
    />
  );
}
