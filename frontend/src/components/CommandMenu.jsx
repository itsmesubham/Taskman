import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../utils.js';

const BASE_COMMANDS = [
  { id: 'create-task', label: 'Create task', hint: 'Open the create task drawer', shortcut: 'C' },
  { id: 'search-task', label: 'Search task', hint: 'Focus the search field', shortcut: '⌘K' },
  { id: 'open-board', label: 'Open Board', hint: 'Go to the board view' },
  { id: 'open-backlog', label: 'Open Backlog', hint: 'Go to backlog' },
  { id: 'open-my-tasks', label: 'Open My Tasks', hint: 'Go to your tasks' },
  { id: 'open-projects', label: 'Open Projects', hint: 'Go to projects' },
  { id: 'open-sprints', label: 'Open Sprints', hint: 'Go to sprints' },
  { id: 'open-reports', label: 'Open Reports', hint: 'Go to reports' },
  { id: 'open-current-sprint', label: 'Open current sprint', hint: 'Jump to the active sprint board' },
  { id: 'create-sprint', label: 'Create sprint manually', hint: 'Open the Sprints screen' }
];

const STATUS_COMMANDS = [
  { id: 'move-todo', label: 'Move selected task to Todo', hint: 'Requires a selected task' },
  { id: 'move-progress', label: 'Move selected task to In Progress', hint: 'Requires a selected task' },
  { id: 'move-review', label: 'Move selected task to Review', hint: 'Requires a selected task' },
  { id: 'move-done', label: 'Move selected task to Done', hint: 'Requires a selected task' },
  { id: 'assign-task', label: 'Assign task', hint: 'Open the selected task drawer' },
  { id: 'change-priority', label: 'Change priority', hint: 'Open the selected task drawer' }
];

export default function CommandMenu({ open, onClose, onAction, selectedIssue }) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
    return undefined;
  }, [open]);

  const commands = useMemo(() => {
    const grouped = [...BASE_COMMANDS, ...(selectedIssue ? STATUS_COMMANDS : [])];
    const filtered = grouped.filter((command) => {
      const text = `${command.label} ${command.hint || ''}`.toLowerCase();
      return text.includes(query.trim().toLowerCase());
    });
    return filtered;
  }, [query, selectedIssue]);

  useEffect(() => {
    if (activeIndex >= commands.length) setActiveIndex(0);
  }, [activeIndex, commands.length]);

  if (!open) return null;

  const choose = (command) => {
    onAction(command.id);
    onClose();
  };

  return (
    <div className="command-backdrop" onMouseDown={onClose}>
      <div className="command-menu" onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-menu-head">
          <span className="muted">⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((current) => Math.min(current + 1, Math.max(commands.length - 1, 0)));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
              }
              if (event.key === 'Enter' && commands[activeIndex]) {
                event.preventDefault();
                choose(commands[activeIndex]);
              }
              if (event.key === 'Escape') onClose();
            }}
            placeholder="Search commands"
          />
          <button type="button" className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="command-menu-list" role="menu">
          {commands.length ? commands.map((command, index) => (
            <button
              key={command.id}
              type="button"
              className={cx('command-menu-item', index === activeIndex && 'active')}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(command)}
            >
              <div>
                <strong>{command.label}</strong>
                <span>{command.hint}</span>
              </div>
              {command.shortcut && <span className="command-menu-shortcut">{command.shortcut}</span>}
            </button>
          )) : (
            <div className="empty-inline" style={{ margin: 16 }}>No commands match this search.</div>
          )}
        </div>
      </div>
    </div>
  );
}
