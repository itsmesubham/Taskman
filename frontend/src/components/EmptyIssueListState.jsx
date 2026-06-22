export default function EmptyIssueListState({ title, text, actionLabel, onAction }) {
  return (
    <div className="empty-issue-list">
      <div className="empty-issue-list-card">
        <p className="eyebrow">Taskman</p>
        <h3>{title}</h3>
        <p>{text}</p>
        {onAction && actionLabel ? (
          <button type="button" className="primary" onClick={onAction}>{actionLabel}</button>
        ) : null}
      </div>
    </div>
  );
}
