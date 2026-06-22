import { useState } from 'react';
import { ISSUE_TYPES, PRIORITIES } from '../constants.js';

export default function CreateIssuePanel({ defaultStatus = 'BACKLOG', projectId, onCreate }) {
  const [open, setOpen] = useState(true);
  const [title, setTitle] = useState('');
  const [issueType, setIssueType] = useState('TASK');
  const [priority, setPriority] = useState('MEDIUM');
  const [points, setPoints] = useState(3);
  const [description, setDescription] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!projectId) return;
    await onCreate({ project_id: projectId, title, description, issue_type: issueType, priority, story_points: Number(points) || 0, status: defaultStatus });
    setTitle('');
    setDescription('');
    setPoints(3);
  };

  return (
    <section className="panel form-panel">
      <div className="panel-head"><h3>Create issue</h3><button className="ghost" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button></div>
      {open && <form className="form-grid" onSubmit={submit}>
        <label className="wide">Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short business-focused task title" required /></label>
        <label>Type<select value={issueType} onChange={(e) => setIssueType(e.target.value)}>{ISSUE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label>Priority<select value={priority} onChange={(e) => setPriority(e.target.value)}>{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Story points<input type="number" min="0" max="100" value={points} onChange={(e) => setPoints(e.target.value)} /></label>
        <label className="wide">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details, acceptance criteria, dependencies" /></label>
        <div className="form-actions wide"><button className="primary" disabled={!projectId}>Create issue</button></div>
      </form>}
    </section>
  );
}
