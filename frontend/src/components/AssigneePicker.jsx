import { initials } from '../utils.js';

export default function AssigneePicker({ members = [], value = '', query = '', onQueryChange, onChange }) {
  const selected = members.find((member) => member.id === value) || null;
  return (
    <div className="assignee-picker">
      <div className="assignee-chip">
        <div className="avatar">{selected ? initials(selected.name) : 'U'}</div>
        <div>
          <strong>{selected?.name || 'Unassigned'}</strong>
          <span>{selected?.email || 'Search teammates'}</span>
        </div>
      </div>
      <input
        list="assignee-options"
        value={query}
        onChange={(event) => onQueryChange?.(event.target.value)}
        placeholder="Type a name or email"
      />
      <datalist id="assignee-options">
        {members.map((member) => <option key={member.id} value={member.name}>{member.email}</option>)}
      </datalist>
    </div>
  );
}
