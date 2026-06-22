import { useWorkspace } from '../context/WorkspaceContext.jsx';

export default function MobileBottomNav() {
  const { page, setPage } = useWorkspace();
  const items = [['dashboard', 'Home'], ['backlog', 'Backlog'], ['board', 'Board'], ['sprints', 'Sprints'], ['ai', 'AI']];
  return <nav className="bottom-nav">{items.map(([key, label]) => <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}>{label}</button>)}</nav>;
}
