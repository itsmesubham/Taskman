import IssueListToolbar from './IssueListToolbar.jsx';
import IssueListRow from './IssueListRow.jsx';
import IssueSelectionToolbar from './IssueSelectionToolbar.jsx';
import EmptyIssueListState from './EmptyIssueListState.jsx';

export default function IssueList({
  mode,
  title,
  description,
  items,
  totalCount,
  filters,
  onFiltersChange,
  members,
  sprints,
  selectedIds,
  onToggleSelected,
  onClearSelection,
  onOpenIssue,
  onCopyIssueLink,
  onCreateTask,
  onAddSelectedToSprint,
  targetSprintId,
  onTargetSprintChange,
  onUpdateIssue,
  onDeleteIssue,
}) {
  const count = selectedIds.length;
  const emptyTitle = mode === 'my-tasks' ? 'No tasks match your filters' : 'No backlog issues yet';
  const emptyText = mode === 'my-tasks'
    ? 'Adjust filters or create work that will be assigned to you.'
    : 'Create tasks here and move them into a sprint when they are ready.';

  return (
    <section className="panel issue-list-panel">
      <div className="panel-head wrap issue-list-header">
        <div>
          <h3>{title}</h3>
          <span>{description}</span>
        </div>
        <div className="issue-list-counts">
          <span>{items.length} shown</span>
          <span>{totalCount} total</span>
        </div>
      </div>

      <IssueListToolbar mode={mode} filters={filters} onFiltersChange={onFiltersChange} members={members} />

      {mode === 'backlog' ? (
        <IssueSelectionToolbar
          count={count}
          sprintId={targetSprintId}
          onSprintChange={onTargetSprintChange}
          sprints={sprints}
          onAddToSprint={onAddSelectedToSprint}
          onClear={onClearSelection}
        />
      ) : null}

      <div className="issue-list issue-table">
        {items.map((issue) => (
          <IssueListRow
            key={issue.id}
            issue={issue}
            mode={mode}
            selected={selectedIds.includes(issue.id)}
            members={members}
            sprints={sprints}
            onToggleSelected={onToggleSelected}
            onOpen={onOpenIssue}
            onCopyLink={onCopyIssueLink}
            onUpdate={onUpdateIssue}
            onDelete={onDeleteIssue}
          />
        ))}
        {!items.length && (
          <EmptyIssueListState
            title={emptyTitle}
            text={emptyText}
            actionLabel="Create Task"
            onAction={onCreateTask}
          />
        )}
      </div>
    </section>
  );
}
