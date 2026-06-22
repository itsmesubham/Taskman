import { useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { EmptyInline } from '../components/EmptyState.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { formatDate } from '../utils.js';
import SprintScheduleCard from '../components/SprintScheduleCard.jsx';

function SprintSection({ id, title, items, emptyText, action }) {
  return (
    <section className="panel" id={id}>
      <div className="panel-head wrap">
        <div><h3>{title}</h3><span>{items.length}</span></div>
        {action}
      </div>
      <div className="sprint-grid">
        {items.map((sprint) => (
          <article className="sprint-card" key={sprint.id}>
            <div className="sprint-card-top">
              <div>
                <h4>{sprint.name}</h4>
                <span>{sprint.project_key} · {sprint.status}</span>
              </div>
              <span className={`sprint-status ${String(sprint.status || '').toLowerCase()}`}>{sprint.status}</span>
            </div>
            <p className="muted">{sprint.goal || 'No sprint goal.'}</p>
            <div className="sprint-meta"><span>{formatDate(sprint.start_date)}</span><span>→</span><span>{formatDate(sprint.end_date)}</span></div>
            <div className="progress-line"><span style={{ width: `${sprint.issue_count ? Math.round((sprint.done_count / sprint.issue_count) * 100) : 0}%` }} /></div>
            <div className="sprint-summary-row"><strong>{sprint.done_count || 0}/{sprint.issue_count || 0}</strong><span>issues done</span></div>
          </article>
        ))}
      </div>
      {!items.length && <EmptyInline title={title} text={emptyText} />}
    </section>
  );
}

export default function SprintsPage() {
  const { activeProject, projectSprints, backlogIssues, createSprint, startSprint, completeSprint, addIssuesToSprint, setSelectedIssue, sprintSchedule } = useWorkspace();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedBacklog, setSelectedBacklog] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!activeProject?.id) return;
    await createSprint({ project_id: activeProject.id, name, goal, start_date: startDate || null, end_date: endDate || null });
    setName('');
    setGoal('');
    setStartDate('');
    setEndDate('');
    setCreateOpen(false);
  };

  const active = useMemo(() => projectSprints.filter((sprint) => sprint.status === 'ACTIVE'), [projectSprints]);
  const upcoming = useMemo(() => projectSprints.filter((sprint) => sprint.status === 'PLANNED'), [projectSprints]);
  const completed = useMemo(() => projectSprints.filter((sprint) => sprint.status === 'COMPLETED'), [projectSprints]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Agile delivery"
        title="Sprint planning"
        description="Monthly auto-sprints keep work moving without manual setup."
        action={<button className="primary" onClick={() => setCreateOpen((current) => !current)}>{createOpen ? 'Close' : 'Manual Create Sprint'}</button>}
      />

      <SprintScheduleCard sprintSchedule={sprintSchedule} />

      {createOpen && (
        <section className="panel">
          <div className="panel-head"><h3>Create sprint</h3><span>Manual only, auto sprint stays enabled</span></div>
          <form className="form-grid" onSubmit={submit}>
            <label>Sprint name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 1" required /></label>
            <label>Start date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
            <label>End date<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
            <label className="wide">Goal<textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What business outcome should this sprint deliver?" /></label>
            <div className="form-actions wide"><button className="primary" disabled={!activeProject}>Create sprint</button></div>
          </form>
        </section>
      )}

      <SprintSection
        id="current-sprints"
        title="Active"
        items={active}
        emptyText="No active sprint."
      />
      <SprintSection
        id="upcoming-sprints"
        title="Upcoming"
        items={upcoming}
        emptyText="No upcoming sprint."
      />
      <SprintSection
        id="completed-sprints"
        title="Completed"
        items={completed}
        emptyText="No completed sprint yet."
      />

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
