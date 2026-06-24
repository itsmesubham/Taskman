const QUICK_FILTERS = [
  { key: 'ALL', label: 'All tasks' },
  { key: 'ME', label: 'Mine' },
  { key: 'UNASSIGNED', label: 'Unassigned' },
  { key: 'HIGH', label: 'High' },
  { key: 'DUE_WEEK', label: 'This week' },
  { key: 'BLOCKED', label: 'Blocked' },
  { key: 'AI_WORKING', label: 'AI working' },
  { key: 'PR_OPEN', label: 'PR open' },
  { key: 'CHANGES_REQUESTED', label: 'Changes requested' }
];

export default function QuickFilters({ value, onChange }) {
  return (
    <div className="quick-filters">
      {QUICK_FILTERS.map((filter) => (
        <button
          key={filter.key}
          type="button"
          className={`chip ${value === filter.key ? 'active' : ''} chip-${filter.key.toLowerCase().replace(/_/g, '-')}`}
          onClick={() => onChange(filter.key)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
