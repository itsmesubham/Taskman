import { useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { EmptyInline } from '../components/EmptyState.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { formatDate } from '../utils.js';

export default function SprintsPage() {
  const { activeProject, projectSprints, backlogIssues, createSprint, startSprint, completeSprint, addIssuesToSprint, setSelectedIssue } = useWorkspace();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedBacklog, setSelectedBacklog] = useState([]);

  const submit = async (event) => {
    event.preventDefault();
    if (!activeProject?.id) return;
    await createSprint({ project_id: activeProject.id, name, goal, start_date: startDate || null, end_date: endDate || null });
    setName('');
    setGoal('');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Agile delivery" title="Sprint planning" description="Create sprints, pull in backlog, start execution, and complete work cleanly." />
      <section className="panel form-panel">
        <form className="form-grid" onSubmit={submit}>
          <label>Sprint name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 1" required /></label>
          <label>Start date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label>End date<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <label className="wide">Goal<textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What business outcome should this sprint deliver?" /></label>
          <div className="form-actions wide"><button className="primary" disabled={!activeProject}>Create sprint</button></div>
        </form>
      </section>

      <div className="sprint-grid">
        {projectSprints.map((sprint) => {
          const picked = backlogIssues.filter((issue) => selectedBacklog.includes(issue.id));
          return <section className="panel sprint-card" key={sprint.id}>
            <div className="panel-head wrap"><div><h3>{sprint.name}</h3><span>{sprint.status} · {sprint.project_key}</span></div><span className={`sprint-status ${sprint.status.toLowerCase()}`}>{sprint.status}</span></div>
            <p className="muted">{sprint.goal || 'No sprint goal.'}</p>
            <div className="sprint-meta"><span>{formatDate(sprint.start_date)}</span><span>→</span><span>{formatDate(sprint.end_date)}</span></div>
            <div className="progress-line"><span style={{ width: `${sprint.issue_count ? Math.round((sprint.done_count / sprint.issue_count) * 100) : 0}%` }} /></div>
            <div className="sprint-actions">
              {sprint.status === 'PLANNED' && <button className="primary" onClick={() => startSprint(sprint.id)}>Start</button>}
              {sprint.status === 'ACTIVE' && <button className="danger" onClick={() => completeSprint(sprint.id)}>Complete</button>}
              {sprint.status !== 'COMPLETED' && <button className="ghost" disabled={!picked.length} onClick={() => addIssuesToSprint(sprint.id, selectedBacklog)}>Add selected backlog</button>}
            </div>
          </section>;
        })}
        {!projectSprints.length && <EmptyInline title="No sprints yet" text="Create a sprint above for the selected project." />}
      </div>

      <section className="panel">
        <div className="panel-head"><h3>Backlog available for sprint</h3><span>{selectedBacklog.length} selected</span></div>
        <div className="issue-list compact">
          {backlogIssues.slice(0, 20).map((issue) => <div className="issue-row" key={issue.id}>
            <input type="checkbox" checked={selectedBacklog.includes(issue.id)} onChange={() => setSelectedBacklog((current) => current.includes(issue.id) ? current.filter((id) => id !== issue.id) : [...current, issue.id])} />
            <button className="issue-row-main" onClick={() => setSelectedIssue(issue)}><strong>{issue.issue_key}</strong><span>{issue.title}</span></button>
            <span className="points">{issue.story_points || 0} pts</span>
          </div>)}
        </div>
      </section>
    </div>
  );
}
