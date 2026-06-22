export default function IssueSelectionToolbar({ count, sprintId, onSprintChange, sprints = [], onAddToSprint, onClear }) {
  if (!count) return null;

  return (
    <div className="issue-selection-toolbar">
      <div className="issue-selection-copy">
        <strong>{count} selected</strong>
        <span>Move selected issues into a sprint when they are ready.</span>
      </div>
      <div className="issue-selection-actions">
        <select value={sprintId} onChange={(event) => onSprintChange(event.target.value)}>
          <option value="">Select sprint</option>
          {sprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}
        </select>
        <button type="button" className="primary" disabled={!sprintId} onClick={onAddToSprint}>
          Add {count} to sprint
        </button>
        <button type="button" className="ghost" onClick={onClear}>Clear selection</button>
      </div>
    </div>
  );
}
