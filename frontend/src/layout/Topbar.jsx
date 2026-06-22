import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { cx } from '../utils.js';

export default function Topbar({ onMenu }) {
  const { activeProjectId, setActiveProjectId, projects, activeProject, query, setQuery, eventStatus, loading, loadWorkspace } = useWorkspace();

  return (
    <header className="topbar">
      <button className="icon-btn mobile-only" onClick={onMenu}>☰</button>
      <div className="project-switcher">
        <span>Project</span>
        <select value={activeProjectId} onChange={(event) => setActiveProjectId(event.target.value)}>
          <option value="">All projects</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}
        </select>
      </div>
      <div className="global-search">
        <span>⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${activeProject?.key || 'workspace'} issues`} />
      </div>
      <button className="ghost desktop-only" onClick={() => loadWorkspace()}>{loading ? 'Syncing...' : 'Refresh'}</button>
      <span className={cx('realtime-pill', eventStatus)}>{eventStatus}</span>
    </header>
  );
}
