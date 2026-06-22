import { formatDate } from '../utils.js';

export default function ActivityList({ items }) {
  if (!items?.length) return <p className="muted">No activity yet.</p>;
  return (
    <div className="activity-list">
      {items.map((item) => (
        <div className="activity-item" key={item.id}>
          <div className="dot" />
          <div><strong>{item.actor_name || 'System'}</strong><p>{item.message}</p><small>{formatDate(item.created_at)}</small></div>
        </div>
      ))}
    </div>
  );
}
