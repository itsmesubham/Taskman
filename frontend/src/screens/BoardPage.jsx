import CreateTaskDrawer from '../components/CreateTaskDrawer.jsx';
import BoardColumn from '../components/BoardColumn.jsx';
import BoardSummary from '../components/BoardSummary.jsx';
import QuickFilters from '../components/QuickFilters.jsx';
import TaskCard from '../components/TaskCard.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import BoardToolbar from '../layout/BoardToolbar.jsx';
import { getTaskUrl } from '../utils/taskRoutes.js';
import { getBoardWorkflowStatus } from '../utils/taskWorkflow.js';

const BOARD_COLUMNS = [
  { key: 'TODO', label: 'Todo', className: 'todo' },
  { key: 'IN_PROGRESS', label: 'In Progress', className: 'in_progress' },
  { key: 'IN_REVIEW', label: 'Review', className: 'in_review' },
  { key: 'DONE', label: 'Done', className: 'done' }
];

export default function BoardPage() {
  const {
    session,
    filteredBoardIssues,
    taskDrawerOpen,
    taskDrawerDefaultStatus,
    openCreateTaskDrawer,
    closeCreateTaskDrawer,
    draggedIssueId,
    setDraggedIssueId,
    moveIssueStatus,
    setSelectedIssue,
    members,
    updateIssue,
    boardQuickFilter,
    setBoardQuickFilter,
    navigate,
    showSuccess,
    showError
  } = useWorkspace();

  const columns = BOARD_COLUMNS.map((status) => ({
    ...status,
    helper: {
      TODO: 'Plan new work here',
      IN_PROGRESS: 'Work being done by humans or agents',
      IN_REVIEW: 'PRs, approvals, and changes requested',
      DONE: 'Completed and merged work'
    }[status.key],
    issues: filteredBoardIssues.filter((issue) => {
      const mapped = getBoardWorkflowStatus(issue);
      return mapped === status.key;
    })
  }));

  const handleAssign = async (issueId, assigneeId) => {
    await updateIssue(issueId, { assignee_id: assigneeId });
  };
  const openTask = (issue) => {
    setSelectedIssue(issue);
    navigate(getTaskUrl(issue, session.tenant));
  };
  const copyTaskLink = async (issue) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${getTaskUrl(issue, session.tenant)}`);
      showSuccess('Task link copied');
    } catch {
      showError(new Error('Unable to copy task link'));
    }
  };

  const totalTasks = filteredBoardIssues.length;
  const assignedToMe = filteredBoardIssues.filter((issue) => issue.assignee_id === session.user?.id).length;
  const dueSoon = filteredBoardIssues.filter((issue) => {
    if (!issue.due_date) return false;
    const today = new Date();
    const weekAhead = new Date();
    weekAhead.setDate(today.getDate() + 7);
    const due = new Date(issue.due_date);
    return due >= new Date(today.toDateString()) && due <= weekAhead;
  }).length;
  const blocked = filteredBoardIssues.filter((issue) => issue.status === 'BLOCKED').length;

  return (
    <div className="page-stack board-page">
      <BoardToolbar />
      <BoardSummary total={totalTasks} assignedToMe={assignedToMe} dueSoon={dueSoon} blocked={blocked} />
      <QuickFilters value={boardQuickFilter} onChange={setBoardQuickFilter} />

      <section className="board-rail compact">
        <div className="board-scroll">
          <div className="kanban-board four-column">
            {columns.map((column) => (
              <BoardColumn
                key={column.key}
                title={column.label}
                count={column.issues.length}
                emptyText={column.helper}
                empty={!column.issues.length}
                className={column.className}
                onAddTask={() => openCreateTaskDrawer(column.key)}
                onDrop={async () => {
                  if (draggedIssueId) await moveIssueStatus(draggedIssueId, column.key);
                  setDraggedIssueId(null);
                }}
              >
                {column.issues.map((issue) => (
                  <TaskCard
                    key={issue.id}
                    issue={issue}
                    members={members}
                    draggable
                    onDragStart={() => setDraggedIssueId(issue.id)}
                    onClick={() => openTask(issue)}
                    onOpenTask={openTask}
                    onCopyLink={copyTaskLink}
                    onAssign={handleAssign}
                  />
                ))}
              </BoardColumn>
            ))}
          </div>
        </div>
      </section>

      <CreateTaskDrawer
        open={taskDrawerOpen}
        onClose={closeCreateTaskDrawer}
        defaultStatus={taskDrawerDefaultStatus}
      />
    </div>
  );
}
