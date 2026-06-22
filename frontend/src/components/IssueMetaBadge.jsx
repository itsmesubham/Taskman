import { cx, formatDate, priorityClass } from '../utils.js';

export default function IssueMetaBadge({ type, value, className }) {
  if (!value) return null;
  if (type === 'priority') {
    return <span className={cx(priorityClass(value), 'issue-meta-badge', className)}>{value}</span>;
  }
  if (type === 'status') {
    return <span className={cx('status-pill', String(value).toLowerCase(), 'issue-meta-badge', className)}>{value.replaceAll('_', ' ')}</span>;
  }
  if (type === 'date') {
    return <span className={cx('issue-meta-badge', 'muted', className)}>{formatDate(value)}</span>;
  }
  if (type === 'points') {
    return <span className={cx('issue-meta-badge', 'muted', className)}>{value}</span>;
  }
  return <span className={cx('issue-meta-badge', className)}>{value}</span>;
}
