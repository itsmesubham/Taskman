import { initials, cx } from '../utils.js';

export default function AssigneeAvatar({ name, email, compact = false, unassignedLabel = 'Unassigned' }) {
  if (!name) {
    return (
      <span className={cx('assignee-avatar', compact && 'compact', 'unassigned')}>
        <span className="assignee-avatar-mark">U</span>
        <span className="assignee-avatar-copy">
          <strong>{unassignedLabel}</strong>
          {!compact && <small>Not assigned</small>}
        </span>
      </span>
    );
  }

  return (
    <span className={cx('assignee-avatar', compact && 'compact')}>
      <span className="assignee-avatar-mark">{initials(name)}</span>
      <span className="assignee-avatar-copy">
        <strong>{name}</strong>
        {!compact && <small>{email || 'Assignee'}</small>}
      </span>
    </span>
  );
}
