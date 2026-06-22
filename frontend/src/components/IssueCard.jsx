import { priorityClass } from '../utils.js';

export default function IssueCard({ issue, draggable = false, onDragStart, onClick }) {
  return (
    <article className="issue-card" draggable={draggable} onDragStart={onDragStart} onClick={onClick}>
      <div className="issue-card-head"><strong>{issue.issue_key}</strong><span className={priorityClass(issue.priority)}>{issue.priority}</span></div>
      <h4>{issue.title}</h4>
      <p>{issue.description || 'No description'}</p>
      <div className="card-meta"><span>{issue.issue_type}</span><span>{issue.story_points || 0} pts</span><span>{issue.assignee_name || 'Unassigned'}</span></div>
    </article>
  );
}

export function IssueCompact({ issue }) {
  return <div className="issue-row"><span className="issue-row-main"><strong>{issue.issue_key}</strong><span>{issue.title}</span></span><span className={priorityClass(issue.priority)}>{issue.priority}</span><span className="points">{issue.story_points || 0} pts</span></div>;
}
