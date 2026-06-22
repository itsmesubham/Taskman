export default function BoardSummary({ total, assignedToMe, dueSoon, blocked }) {
  const items = [
    { label: 'Total', value: total },
    { label: 'Mine', value: assignedToMe },
    { label: 'Due soon', value: dueSoon },
    { label: 'Blocked', value: blocked }
  ];

  return (
    <div className="board-summary">
      {items.map((item) => (
        <article className="summary-card" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </div>
  );
}
