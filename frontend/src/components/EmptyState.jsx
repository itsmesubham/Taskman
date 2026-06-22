export function EmptyInline({ title, text }) {
  return <div className="empty-inline"><strong>{title}</strong><p>{text}</p></div>;
}

export default function EmptyState({ title, text, action }) {
  return <div className="empty-state full-height"><div className="empty-illustration">□</div><h2>{title}</h2><p>{text}</p>{action}</div>;
}
