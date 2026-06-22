import { cx } from '../utils.js';

const backlogQuickFilters = [
  ['ALL', 'All'],
  ['UNASSIGNED', 'Unassigned'],
  ['HIGH', 'High priority'],
  ['NO_ESTIMATE', 'No estimate'],
  ['RECENT', 'Recently created'],
];

const myTaskQuickFilters = [
  ['ALL', 'All'],
  ['ASSIGNED', 'Assigned to me'],
  ['CREATED', 'Created by me'],
  ['DUE_SOON', 'Due soon'],
  ['HIGH', 'High priority'],
  ['OPEN', 'Not done'],
];

export default function IssueListToolbar({
  mode,
  filters,
  onFiltersChange,
  members = []
}) {
  const isMyTasks = mode === 'my-tasks';
  const quickFilters = isMyTasks ? myTaskQuickFilters : backlogQuickFilters;

  return (
    <div className="issue-list-toolbar">
      <label className="issue-toolbar-search">
        <span>Search issues</span>
        <input
          value={filters.search}
          onChange={(event) => onFiltersChange({ search: event.target.value })}
          placeholder="Search by key, title, description"
        />
      </label>

      {isMyTasks ? (
        <>
          <label>
            <span>Status</span>
            <select value={filters.status} onChange={(event) => onFiltersChange({ status: event.target.value })}>
              <option value="ALL">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="DONE">Done</option>
            </select>
          </label>
        </>
      ) : (
        <>
          <label>
            <span>Priority</span>
            <select value={filters.priority} onChange={(event) => onFiltersChange({ priority: event.target.value })}>
              <option value="ALL">All priorities</option>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </label>
          <label>
            <span>Assignee</span>
            <select value={filters.assignee} onChange={(event) => onFiltersChange({ assignee: event.target.value })}>
              <option value="ALL">Any assignee</option>
              <option value="UNASSIGNED">Unassigned</option>
              {members.map((member) => <option key={member.id || member.user_id} value={member.id || member.user_id}>{member.name || member.user_name || member.email}</option>)}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={filters.status} onChange={(event) => onFiltersChange({ status: event.target.value })}>
              <option value="ALL">All statuses</option>
              <option value="BACKLOG">Backlog</option>
              <option value="TODO">Todo</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="IN_REVIEW">Review</option>
              <option value="DONE">Done</option>
              <option value="BLOCKED">Blocked</option>
            </select>
          </label>
        </>
      )}

      <div className="issue-chip-row">
        {quickFilters.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={cx('chip', filters.quick === value && 'active')}
            onClick={() => onFiltersChange({ quick: value })}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
