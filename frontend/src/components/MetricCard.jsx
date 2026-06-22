export default function MetricCard({ label, value, helper }) {
  return <section className="metric-card"><span>{label}</span><strong>{value}</strong><p>{helper}</p></section>;
}
