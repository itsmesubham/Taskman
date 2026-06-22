import PriorityBadge from './PriorityBadge.jsx';
import ProjectBadge from './ProjectBadge.jsx';
import StatusPill from './StatusPill.jsx';
import { initials } from '../utils.js';

export default function TaskCard({ issue, members = [], draggable = false, onDragStart, onClick, onAssign }) {
  const assigneeOptions = members.length ? members : [];
  const assigneeLabel = issue.assignee_name || 'Unassigned';

  return (
    <article className="issue-card issue-card-compact" draggable={draggable} onDragStart={onDragStart} onClick={onClick}>
      <div className="issue-card-head">
        <div className="issue-card-key">
          <strong>{issue.issue_key}</strong>
          <PriorityBadge priority={issue.priority} />
        </div>
        <StatusPill status={issue.status} />
      </div>

      <h4>{issue.title}</h4>

      {issue.description && <p className="issue-card-desc">{issue.description}</p>}

      <div className="card-meta">
        {issue.story_points ? <span>{issue.story_points} pts</span> : null}
        {issue.due_date && <span>{issue.due_date}</span>}
        {issue.sprint_name && <span className="sprint-badge">{issue.sprint_name}</span>}
        {issue.project_key && <ProjectBadge projectKey={issue.project_key} />}
      </div>

      <div className="card-footer">
        <div className="card-assignee-copy">
          <span>{initials(assigneeLabel)}</span>
          <div>
            <strong>{assigneeLabel}</strong>
            <small>{issue.assignee_name ? 'Assigned' : 'Unassigned'}</small>
          </div>
        </div>
        <label className="card-assignee">
          <select
            value={issue.assignee_id || ''}
            onChange={(event) => {
              event.stopPropagation();
              onAssign?.(issue.id, event.target.value || null);
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <option value="">Unassigned</option>
            {assigneeOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
      </div>
    </article>
  );
}
