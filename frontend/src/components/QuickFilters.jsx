const QUICK_FILTERS = [
  { key: 'ALL', label: 'All tasks' },
  { key: 'ME', label: 'Mine' },
  { key: 'UNASSIGNED', label: 'Unassigned' },
  { key: 'HIGH', label: 'High' },
  { key: 'DUE_WEEK', label: 'This week' },
  { key: 'BLOCKED', label: 'Blocked' }
];

export default function QuickFilters({ value, onChange }) {
  return (
    <div className="quick-filters">
      {QUICK_FILTERS.map((filter) => (
        <button
          key={filter.key}
          type="button"
          className={value === filter.key ? 'chip active' : 'chip'}
          onClick={() => onChange(filter.key)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
