export default function Distribution({ items = [], labelKey }) {
  const max = Math.max(...items.map((item) => Number(item.count) || 0), 1);
  if (!items.length) return <p className="muted">No data yet.</p>;
  return (
    <div className="distribution">
      {items.map((item) => (
        <div className="dist-row" key={item[labelKey]}>
          <span>{item[labelKey]}</span>
          <div><b style={{ width: `${((Number(item.count) || 0) / max) * 100}%` }} /></div>
          <strong>{item.count}</strong>
        </div>
      ))}
    </div>
  );
}
