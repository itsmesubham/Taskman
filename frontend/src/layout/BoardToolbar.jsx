import { useWorkspace } from '../context/WorkspaceContext.jsx';
import SavedViewsMenu from '../components/SavedViewsMenu.jsx';

export default function BoardToolbar() {
  const {
    activeProjectId,
    setActiveProjectId,
    projects,
    activeSprint,
    projectSprints,
    filteredBoardIssues,
    boardSprintId,
    setBoardSprintId,
    boardFilter,
    setBoardFilter,
    loading,
    loadWorkspace
  } = useWorkspace();

  return (
    <section className="board-toolbar">
      <div className="board-toolbar-copy">
        <h1>Grabbit board</h1>
        <p>{activeSprint ? `Current sprint · ${filteredBoardIssues.length} active tasks` : `${filteredBoardIssues.length} active tasks`}</p>
      </div>

      <div className="board-toolbar-controls">
        <div className="control-group">
          <span>Project</span>
          <select value={activeProjectId} onChange={(event) => setActiveProjectId(event.target.value)}>
            <option value="">All projects</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}
          </select>
        </div>
        <div className="control-group">
          <span>Sprint</span>
          <select value={boardSprintId} onChange={(event) => setBoardSprintId(event.target.value)}>
            <option value="active">Current sprint{activeSprint ? ` · ${activeSprint.name}` : ''}</option>
            <option value="all">All tasks</option>
            {projectSprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}
          </select>
        </div>
        <div className="control-group">
          <span>Status</span>
          <select value={boardFilter} onChange={(event) => setBoardFilter(event.target.value)}>
            <option value="ALL">All statuses</option>
            <option value="TODO">Todo</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="REVIEW">Review</option>
            <option value="DONE">Done</option>
            <option value="BLOCKED">Blocked</option>
          </select>
        </div>
        <SavedViewsMenu />
        <button type="button" className="ghost" onClick={() => loadWorkspace()}>{loading ? 'Syncing...' : 'Refresh'}</button>
      </div>
    </section>
  );
}
