import { initials } from '../utils.js';
import { getBoardWorkflowStatus, getTaskStateBadges } from '../utils/taskWorkflow.js';

export default function TaskCard({ issue, members = [], draggable = false, onDragStart, onClick, onAssign, onOpenTask, onCopyLink }) {
  const assigneeOptions = members.length ? members : [];
  const assigneeLabel = issue.assignee_name || 'Unassigned';
  const agentBadges = getTaskStateBadges(issue);
  const workflowStatus = getBoardWorkflowStatus(issue);
  const repositoryLabel = (issue.repository_name || issue.github_repo || '').split('/').pop();
  const priorityLabel = String(issue.priority || 'MEDIUM').toLowerCase();
  const metaParts = [
    issue.story_points ? `${issue.story_points} pt${issue.story_points === 1 ? '' : 's'}` : null,
    issue.sprint_name || null,
    issue.due_date || null
  ].filter(Boolean);

  const openTask = () => {
    if (onOpenTask) {
      onOpenTask(issue);
      return;
    }
    onClick?.(issue);
  };

  return (
    <article
      className={`issue-card issue-card-compact ${workflowStatus === 'DONE' ? 'issue-card-done' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
    >
      <div className="issue-card-head">
        <button type="button" className="issue-card-key" onClick={(event) => { event.stopPropagation(); openTask(); }} aria-label={`Open ${issue.issue_key}`}>
          <strong>{issue.issue_key}</strong>
        </button>
        <div className="issue-card-head-side">
          <span className={`card-priority card-priority-${priorityLabel}`}>
            <span className="card-priority-dot" aria-hidden="true" />
            <span>{String(issue.priority || 'Medium').replace('_', ' ')}</span>
          </span>
        </div>
      </div>

      <div className="card-actions">
        {onCopyLink ? <button type="button" className="ghost tiny" onClick={(event) => { event.stopPropagation(); onCopyLink(issue); }}>Copy link</button> : null}
        {onOpenTask ? <button type="button" className="ghost tiny" onClick={(event) => { event.stopPropagation(); onOpenTask(issue); }}>Open</button> : null}
      </div>

      <div className="issue-card-body">
        <h4>{issue.title}</h4>
        {issue.description ? <p className="issue-card-desc">{issue.description}</p> : null}
      </div>

      {metaParts.length ? <p className="card-meta-line">{metaParts.join(' · ')}</p> : null}

      {(repositoryLabel || agentBadges.length) ? (
        <div className="card-meta">
          {repositoryLabel ? <span className="repo-badge">{repositoryLabel}</span> : null}
          {agentBadges.map((badge) => <span key={badge.label} className={`issue-badge task-badge ${badge.tone}`}>{badge.label}</span>)}
        </div>
      ) : null}

      <div className="card-footer">
        <div className="card-assignee-copy">
          <span>{initials(assigneeLabel)}</span>
          <button type="button" className="issue-key-link" onClick={(event) => { event.stopPropagation(); openTask(); }} aria-label={`Open ${issue.issue_key}`}>
            <strong>{assigneeLabel}</strong>
          </button>
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
