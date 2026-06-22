export default function StatusPill({ status }) {
  const value = String(status || 'TODO');
  return <span className={`status-pill ${value.toLowerCase()}`}>{value.replace('_', ' ')}</span>;
}
