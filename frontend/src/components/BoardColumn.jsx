import { cx } from '../utils.js';

export default function BoardColumn({ title, count, emptyText, empty, onAddTask, onDrop, children, className }) {
  return (
    <section
      className={cx('kanban-column', className)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <div className="column-head">
        <div className="column-head-copy">
          <h3>{title}</h3>
          <span>{count}</span>
        </div>
      </div>
      <div className="column-body">
        {children}
        {empty && (
          <div className="column-empty">
            <p>{emptyText}</p>
            <button type="button" className="column-add-link" onClick={onAddTask}>+ Add task</button>
          </div>
        )}
      </div>
    </section>
  );
}
