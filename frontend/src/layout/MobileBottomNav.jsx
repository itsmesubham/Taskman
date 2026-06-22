import { useWorkspace } from '../context/WorkspaceContext.jsx';

export default function MobileBottomNav() {
  const { page, setPage } = useWorkspace();
  const items = [['board', 'Board'], ['backlog', 'Tasks'], ['projects', 'Projects'], ['sprints', 'Sprints'], ['settings', 'Settings']];
  return <nav className="bottom-nav">{items.map(([key, label]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}>{label}</button>)}</nav>;
}
