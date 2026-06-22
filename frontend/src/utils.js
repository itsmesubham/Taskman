export function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function cx(...values) {
  return values.filter(Boolean).join(' ');
}

export function formatDate(value) {
  if (!value) return 'No date';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'U';
}

export function priorityClass(priority) {
  return `priority priority-${String(priority || 'MEDIUM').toLowerCase()}`;
}

export function metricValue(value) {
  if (value === null || value === undefined) return 0;
  return Number(value) || 0;
}
