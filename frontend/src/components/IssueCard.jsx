import { initials, priorityClass } from '../utils.js';
import { getBoardWorkflowStatus, getTaskStateBadges } from '../utils/taskWorkflow.js';

export default function IssueCard({ issue, members = [], draggable = false, onDragStart, onClick, onAssign }) {
  const assigneeOptions = members.length ? members : [];
  const assigneeLabel = issue.assignee_name || 'Unassigned';
  const agentBadges = getTaskStateBadges(issue);
  const workflowStatus = getBoardWorkflowStatus(issue);
  const repositoryLabel = (issue.repository_name || issue.github_repo || '').split('/').pop();
  return (
    <article className="issue-card issue-card-compact" draggable={draggable} onDragStart={onDragStart} onClick={onClick}>
      <div className="issue-card-head">
        <div className="issue-card-key">
          <strong>{issue.issue_key}</strong>
          <span className={priorityClass(issue.priority)}>{issue.priority}</span>
        </div>
        <span className={`status-pill ${String(workflowStatus || '').toLowerCase()}`}>{String(workflowStatus || 'TODO').replace('_', ' ')}</span>
      </div>

      <h4>{issue.title}</h4>

      {issue.description && <p className="issue-card-desc">{issue.description}</p>}

      <div className="card-meta">
        {issue.story_points ? <span>{issue.story_points} pts</span> : null}
        {issue.due_date && <span>{issue.due_date}</span>}
        {issue.project_key && <span className="project-badge">{issue.project_key}</span>}
        {repositoryLabel ? <span className="repo-badge">{repositoryLabel}</span> : null}
        {agentBadges.map((badge) => <span key={badge.label} className={`issue-badge task-badge ${badge.tone}`}>{badge.label}</span>)}
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

export function IssueCompact({ issue }) {
  return <div className="issue-row"><span className="issue-row-main"><strong>{issue.issue_key}</strong><span>{issue.title}</span></span><span className={priorityClass(issue.priority)}>{issue.priority}</span><span className="points">{issue.story_points || 0} pts</span></div>;
}
