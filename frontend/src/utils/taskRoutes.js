export function getTaskUrl(task, workspace) {
  const workspaceSlug = workspace?.slug || workspace?.tenant_slug || '';
  const taskKey = task?.issue_key || task?.task_key || task?.key || '';
  if (!taskKey) return '/';
  if (!workspaceSlug) return `/tasks/${encodeURIComponent(taskKey)}`;
  return `/workspaces/${encodeURIComponent(workspaceSlug)}/tasks/${encodeURIComponent(taskKey)}`;
}

export function parseTaskRoute(pathname = '') {
  const trimmed = String(pathname || '').replace(/\/+$/, '');
  const parts = trimmed.split('/').filter(Boolean);

  if (parts[0] === 'workspaces' && parts[2] === 'tasks' && parts[1] && parts[3]) {
    return {
      kind: 'task',
      workspaceSlug: decodeURIComponent(parts[1]),
      taskKey: decodeURIComponent(parts[3]),
    };
  }

  if (parts[0] === 'tasks' && parts[1]) {
    return {
      kind: 'task',
      workspaceSlug: null,
      taskKey: decodeURIComponent(parts[1]),
    };
  }

  return { kind: 'app' };
}

export function isTaskRoute(pathname = '') {
  return parseTaskRoute(pathname).kind === 'task';
}
