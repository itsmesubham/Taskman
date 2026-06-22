import { useEffect, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { EmptyInline } from '../components/EmptyState.jsx';
import CreateTaskDrawer from '../components/CreateTaskDrawer.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { priorityClass } from '../utils.js';

export default function BacklogPage() {
  const { page, backlogIssues, projectSprints, addIssuesToSprint, setSelectedIssue, taskDrawerOpen, taskDrawerDefaultStatus, closeCreateTaskDrawer, openCreateTaskDrawer } = useWorkspace();
  const [selected, setSelected] = useState([]);
  const [targetSprint, setTargetSprint] = useState('');
  const plannedSprints = projectSprints.filter((sprint) => sprint.status !== 'COMPLETED');

  useEffect(() => {
    if (!targetSprint && plannedSprints[0]) setTargetSprint(plannedSprints[0].id);
  }, [plannedSprints, targetSprint]);

  const toggle = (issueId) => setSelected((current) => current.includes(issueId) ? current.filter((id) => id !== issueId) : [...current, issueId]);
  const addSelected = async () => { await addIssuesToSprint(targetSprint, selected); setSelected([]); };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Planning"
        title={page === 'backlog' ? 'Backlog' : 'My Tasks'}
        description={page === 'backlog'
          ? 'Capture work that is not yet on the board, then pull it into a sprint when ready.'
          : 'View work assigned to you or waiting to be organized into a sprint.'}
        action={<button type="button" className="primary" onClick={() => openCreateTaskDrawer('BACKLOG')}>Create Task</button>}
      />
      <section className="panel">
        <div className="panel-head wrap">
          <div><h3>Backlog items</h3><span>{backlogIssues.length} issues</span></div>
          <div className="inline-controls">
            <select value={targetSprint} onChange={(e) => setTargetSprint(e.target.value)}>
              <option value="">Select sprint</option>
              {plannedSprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}
            </select>
            <button className="primary" disabled={!selected.length || !targetSprint} onClick={addSelected}>Add {selected.length || ''} to sprint</button>
          </div>
        </div>
        <div className="issue-list">
          {backlogIssues.map((issue) => (
            <div className="issue-row" key={issue.id}>
              <input type="checkbox" checked={selected.includes(issue.id)} onChange={() => toggle(issue.id)} />
              <button className="issue-row-main" onClick={() => setSelectedIssue(issue)}><strong>{issue.issue_key}</strong><span>{issue.title}</span></button>
              <span className={priorityClass(issue.priority)}>{issue.priority}</span>
              <span className="points">{issue.story_points || 0} pts</span>
            </div>
          ))}
          {!backlogIssues.length && <EmptyInline title="No backlog issues" text="Create an issue above or generate tasks from AI Planner." />}
        </div>
      </section>
      <CreateTaskDrawer
        open={taskDrawerOpen}
        onClose={closeCreateTaskDrawer}
        defaultStatus={taskDrawerDefaultStatus}
      />
    </div>
  );
}
