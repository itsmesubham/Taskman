import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { cx, readJson, saveJson } from '../utils.js';

const STORAGE_KEY = 'taskman_saved_views_v1';

function createViewId() {
  return `view_${Math.random().toString(36).slice(2, 10)}`;
}

export default function SavedViewsMenu() {
  const {
    activeProjectId,
    boardSprintId,
    boardFilter,
    boardQuickFilter,
    query,
    setActiveProjectId,
    setBoardSprintId,
    setBoardFilter,
    setBoardQuickFilter,
    setQuery
  } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState(() => readJson(STORAGE_KEY, []));
  const ref = useRef(null);

  useEffect(() => saveJson(STORAGE_KEY, views), [views]);

  useEffect(() => {
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  const hasFilters = useMemo(() => (
    activeProjectId || boardSprintId !== 'active' || boardFilter !== 'ALL' || boardQuickFilter !== 'ALL' || query
  ), [activeProjectId, boardSprintId, boardFilter, boardQuickFilter, query]);

  const saveCurrentView = () => {
    const name = window.prompt('Name this saved view', 'Board view');
    if (!name) return;
    const view = {
      id: createViewId(),
      name: name.trim(),
      activeProjectId,
      boardSprintId,
      boardFilter,
      boardQuickFilter,
      query
    };
    setViews((current) => [view, ...current.filter((item) => item.name !== view.name)]);
  };

  const applyView = (view) => {
    setActiveProjectId(view.activeProjectId || '');
    setBoardSprintId(view.boardSprintId || 'active');
    setBoardFilter(view.boardFilter || 'ALL');
    setBoardQuickFilter(view.boardQuickFilter || 'ALL');
    setQuery(view.query || '');
    setOpen(false);
  };

  const renameView = (view) => {
    const nextName = window.prompt('Rename view', view.name);
    if (!nextName) return;
    setViews((current) => current.map((item) => (item.id === view.id ? { ...item, name: nextName.trim() } : item)));
  };

  const duplicateView = (view) => {
    setViews((current) => [{ ...view, id: createViewId(), name: `${view.name} copy` }, ...current]);
  };

  const deleteView = (view) => {
    if (!window.confirm(`Delete "${view.name}"?`)) return;
    setViews((current) => current.filter((item) => item.id !== view.id));
  };

  return (
    <div className="saved-views" ref={ref}>
      <button type="button" className="ghost" onClick={() => setOpen((current) => !current)}>
        Views
      </button>
      {open && (
        <div className="saved-views-menu">
          {hasFilters && (
            <button type="button" className="saved-view-item" onClick={saveCurrentView}>
              <strong>Save current view</strong>
              <span>Store these board filters for later</span>
            </button>
          )}
          {views.length ? views.map((view) => (
            <div className="saved-view-item saved-view-row" key={view.id}>
              <button type="button" onClick={() => applyView(view)}>
                <strong>{view.name}</strong>
                <span>{view.boardQuickFilter !== 'ALL' ? view.boardQuickFilter : 'Board view'}</span>
              </button>
              <div className="saved-view-actions">
                <button type="button" className="ghost" onClick={() => renameView(view)}>Rename</button>
                <button type="button" className="ghost" onClick={() => duplicateView(view)}>Copy</button>
                <button type="button" className="danger" onClick={() => deleteView(view)}>Delete</button>
              </div>
            </div>
          )) : (
            <div className="empty-inline">No saved views yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
