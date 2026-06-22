import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { cx } from '../utils.js';

export default function Topbar({ onMenu }) {
  const {
    activeProjectId,
    setActiveProjectId,
    projects,
    activeProject,
    activeSprint,
    projectSprints,
    boardSprintId,
    setBoardSprintId,
    boardFilter,
    setBoardFilter,
    query,
    setQuery,
    eventStatus,
    loading,
    loadWorkspace
  } = useWorkspace();

  return (
    <header className="topbar">
      <button className="icon-btn mobile-only" onClick={onMenu}>☰</button>
      <div className="workspace-pill">
        <strong>{activeProject?.name || 'Board workspace'}</strong>
        <span>{activeProject?.key || 'Default project'}</span>
      </div>
      <div className="project-switcher">
        <span>Workspace</span>
        <select value={activeProjectId} onChange={(event) => setActiveProjectId(event.target.value)}>
          <option value="">All projects</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}
        </select>
      </div>
      <div className="project-switcher sprint-switcher">
        <span>Sprint</span>
        <select value={boardSprintId} onChange={(event) => setBoardSprintId(event.target.value)}>
          <option value="active">Current sprint{activeSprint ? ` · ${activeSprint.name}` : ''}</option>
          <option value="all">All tasks</option>
          {projectSprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}
        </select>
      </div>
      <div className="project-switcher filter-switcher">
        <span>Filters</span>
        <select value={boardFilter} onChange={(event) => setBoardFilter(event.target.value)}>
          <option value="ALL">All statuses</option>
          <option value="TODO">Todo</option>
          <option value="IN_PROGRESS">In progress</option>
          <option value="REVIEW">Review</option>
          <option value="DONE">Done</option>
          <option value="BLOCKED">Blocked</option>
        </select>
      </div>
      <div className="global-search">
        <span>⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks, assignees, priority" />
      </div>
      <button className="ghost desktop-only" onClick={() => loadWorkspace()}>{loading ? 'Syncing...' : 'Refresh'}</button>
      <span className={cx('realtime-pill', eventStatus)}>{eventStatus}</span>
    </header>
  );
}
