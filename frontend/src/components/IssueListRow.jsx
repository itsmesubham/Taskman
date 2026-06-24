import { useState } from 'react';
import { cx } from '../utils.js';
import AssigneeAvatar from './AssigneeAvatar.jsx';
import IssueMetaBadge from './IssueMetaBadge.jsx';
import { getTaskUrl } from '../utils/taskRoutes.js';

const priorityOptions = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

export default function IssueListRow({
  issue,
  mode,
  selected,
  members = [],
  sprints = [],
  onToggleSelected,
  onOpen,
  onCopyLink,
  onUpdate,
  onDelete,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  const assigneeName = issue.assignee_name || issue.assignee?.name || '';
  const assigneeEmail = issue.assignee_email || issue.assignee?.email || '';
  const sprintLabel = issue.sprint_name || issue.sprint?.name || 'Backlog';
  const selectedAssignee = issue.assignee_id || '';

  const handleRowOpen = () => onOpen(issue);
  const handleAssigneeChange = async (event) => {
    event.stopPropagation();
    await onUpdate(issue.id, { assignee_id: event.target.value || null });
  };
  const handleSprintChange = async (event) => {
    event.stopPropagation();
    await onUpdate(issue.id, { sprint_id: event.target.value || null });
  };
  const handlePriorityChange = async (event) => {
    event.stopPropagation();
    await onUpdate(issue.id, { priority: event.target.value });
  };
  const handleDelete = async (event) => {
    event.stopPropagation();
    setMenuOpen(false);
    await onDelete(issue.id);
  };
  const handleCopyLink = async (event) => {
    event.stopPropagation();
    setMenuOpen(false);
    if (onCopyLink) {
      await onCopyLink(issue);
      return;
    }
    await navigator.clipboard.writeText(`${window.location.origin}${getTaskUrl(issue)}`);
  };

  return (
    <article className={cx('issue-list-row', mode, selected && 'selected')} onClick={handleRowOpen} role="button" tabIndex={0} onKeyDown={(event) => {
      if (event.key === 'Enter') handleRowOpen();
      if (event.key === ' ' && mode === 'backlog') {
        event.preventDefault();
        onToggleSelected(issue.id);
      }
    }}>
      {mode === 'backlog' ? (
        <button
          type="button"
          className="issue-row-check"
          aria-label={`Select ${issue.issue_key}`}
          onClick={(event) => { event.stopPropagation(); onToggleSelected(issue.id); }}
        >
          <span className={cx('checkbox-box', selected && 'checked')}>
            {selected ? '✓' : ''}
          </span>
        </button>
      ) : null}

      <button type="button" className="issue-row-content" onClick={handleRowOpen}>
        <div className="issue-row-keyline">
          <span className="issue-row-key">{issue.issue_key}</span>
          <span className="issue-row-dot">•</span>
          <span className={cx('issue-row-status-copy', String(issue.status || '').toLowerCase())}>{issue.status?.replaceAll('_', ' ') || 'BACKLOG'}</span>
        </div>
        <strong className="issue-row-title">{issue.title}</strong>
        {issue.description ? <span className="issue-row-desc">{issue.description}</span> : null}
      </button>

      <div className="issue-row-meta-stack">
        <IssueMetaBadge type="priority" value={issue.priority} />
        <IssueMetaBadge type="status" value={issue.status} />
        <AssigneeAvatar name={assigneeName} email={assigneeEmail} compact />
        <IssueMetaBadge type="points" value={`${issue.story_points || 0} pts`} />
        {mode === 'my-tasks' ? <IssueMetaBadge type="project" value={issue.project_key || issue.project_name || 'Project'} className="project-badge" /> : null}
      </div>

      <div className="issue-row-side">
        <IssueMetaBadge type="sprint" value={sprintLabel} className={issue.sprint_id ? 'sprint-badge' : 'backlog-badge'} />
        {issue.due_date ? <IssueMetaBadge type="date" value={issue.due_date} className="due-badge" /> : null}
        <details className={cx('issue-row-menu', menuOpen && 'open')} onToggle={(event) => setMenuOpen(event.currentTarget.open)}>
          <summary className="issue-row-menu-button" onClick={(event) => event.stopPropagation()}>⋯</summary>
          <div className="issue-row-menu-panel" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => onOpen(issue)}>Open</button>
            <label>
              <span>Assign</span>
              <select value={selectedAssignee} onChange={handleAssigneeChange}>
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.id || member.user_id} value={member.id || member.user_id}>
                    {member.name || member.user_name || member.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Move to sprint</span>
              <select value={issue.sprint_id || ''} onChange={handleSprintChange}>
                <option value="">Backlog</option>
                {sprints.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select value={issue.priority || 'MEDIUM'} onChange={handlePriorityChange}>
                {priorityOptions.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <div className="issue-row-menu-footer">
              <button type="button" className="ghost" onClick={handleCopyLink}>Copy link</button>
              <button type="button" className="ghost" onClick={() => onOpen(issue)}>Open detail</button>
              <button type="button" className="danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </details>
      </div>
    </article>
  );
}
