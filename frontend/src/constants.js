export const STATUSES = [
  { key: 'TODO', label: 'To do' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'IN_REVIEW', label: 'In review' },
  { key: 'BLOCKED', label: 'Blocked' },
  { key: 'DONE', label: 'Done' }
];

export const ISSUE_STATUSES = ['BACKLOG', ...STATUSES.map((item) => item.key)];
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const ISSUE_TYPES = ['TASK', 'BUG', 'STORY', 'EPIC', 'IMPROVEMENT'];

export const NAV_ITEMS = [
  ['dashboard', 'Dashboard', '▦'],
  ['projects', 'Projects', '□'],
  ['backlog', 'Backlog', '☰'],
  ['board', 'Board', '⇄'],
  ['sprints', 'Sprints', '◷'],
  ['reports', 'Reports', '◌'],
  ['ai', 'AI Planner', '✦'],
  ['settings', 'Settings', '⚙']
];
