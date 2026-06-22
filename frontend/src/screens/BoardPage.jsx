import PageHeader from '../components/PageHeader.jsx';
import IssueCard from '../components/IssueCard.jsx';
import { STATUSES } from '../constants.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';

export default function BoardPage() {
  const { activeProject, boardIssues, projectSprints, boardSprintId, setBoardSprintId, draggedIssueId, setDraggedIssueId, moveIssueStatus, setSelectedIssue } = useWorkspace();
  const activeSprint = projectSprints.find((sprint) => sprint.status === 'ACTIVE');
  const columns = STATUSES.map((status) => ({ ...status, issues: boardIssues.filter((issue) => issue.status === status.key) }));

  return (
    <div className="page-stack board-page">
      <PageHeader
        eyebrow="Execution"
        title={activeProject ? `${activeProject.name} board` : 'Board'}
        description="Drag cards between columns. Changes are persisted and broadcast through SSE."
        action={<select value={boardSprintId} onChange={(e) => setBoardSprintId(e.target.value)}><option value="active">Active sprint{activeSprint ? ` · ${activeSprint.name}` : ''}</option><option value="all">All non-backlog issues</option>{projectSprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}</select>}
      />
      <div className="board-scroll">
        <div className="kanban-board">
          {columns.map((column) => (
            <section className="kanban-column" key={column.key} onDragOver={(event) => event.preventDefault()} onDrop={async () => { if (draggedIssueId) await moveIssueStatus(draggedIssueId, column.key); setDraggedIssueId(null); }}>
              <div className="column-head"><h3>{column.label}</h3><span>{column.issues.length}</span></div>
              <div className="column-body">
                {column.issues.map((issue) => <IssueCard key={issue.id} issue={issue} draggable onDragStart={() => setDraggedIssueId(issue.id)} onClick={() => setSelectedIssue(issue)} />)}
                {!column.issues.length && <div className="drop-hint">Drop issue here</div>}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
