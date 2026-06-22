import { useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { IssueCompact } from '../components/IssueCard.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';

export default function AiPage() {
  const { activeProject, projectSprints, api, createIssue, addIssuesToSprint, showError, showSuccess } = useWorkspace();
  const [prompt, setPrompt] = useState('');
  const [breakdown, setBreakdown] = useState(null);
  const [capacity, setCapacity] = useState(30);
  const [plan, setPlan] = useState(null);
  const [insights, setInsights] = useState(null);
  const [sprintId, setSprintId] = useState('');
  const [busy, setBusy] = useState(false);

  const runBreakdown = async () => {
    setBusy(true);
    try {
      const result = await api.post('/ai/breakdown', { prompt, project_id: activeProject?.id });
      setBreakdown(result);
    } catch (error) { showError(error); } finally { setBusy(false); }
  };

  const createGenerated = async (task) => {
    if (!activeProject?.id) return;
    await createIssue({
      project_id: activeProject.id,
      title: task.title,
      description: (task.acceptance_criteria || []).map((item) => `- ${item}`).join('\n'),
      issue_type: task.issue_type || 'TASK',
      priority: task.priority || 'MEDIUM',
      story_points: task.story_points || 0,
      status: 'BACKLOG'
    });
  };

  const runSprintPlan = async () => {
    if (!activeProject?.id) return;
    try {
      const result = await api.post('/ai/sprint-plan', { project_id: activeProject.id, sprint_id: sprintId || null, capacity_points: Number(capacity) || 30 });
      setPlan(result);
    } catch (error) { showError(error); }
  };

  const addPlanToSprint = async () => {
    if (!sprintId || !plan?.selected_issues?.length) return;
    await addIssuesToSprint(sprintId, plan.selected_issues.map((issue) => issue.id));
    showSuccess('AI-selected issues added to sprint');
  };

  const runInsights = async () => {
    try {
      const result = await api.post('/ai/sprint-insights', { project_id: activeProject?.id, sprint_id: sprintId || null, capacity_points: Number(capacity) || 30 });
      setInsights(result);
    } catch (error) { showError(error); }
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="AI assistant" title="AI Planner" description="Generate implementation tasks, acceptance criteria, sprint scope, and delivery insights." />
      <section className="panel">
        <div className="panel-head"><h3>Break down work</h3><span>{activeProject?.key || 'Select project'}</span></div>
        <textarea className="big-textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Example: Build referral coupon system with validation, one coupon per cart, usage tracking, and admin reports." />
        <div className="form-actions"><button className="primary" disabled={!prompt.trim() || busy} onClick={runBreakdown}>{busy ? 'Thinking...' : 'Generate tasks'}</button></div>
        {breakdown && <div className="ai-output">
          <h4>Suggested tasks</h4>
          <div className="generated-task-list">{breakdown.tasks?.map((task, index) => <article className="generated-task" key={`${task.title}-${index}`}>
            <strong>{task.title}</strong><div className="card-meta"><span>{task.issue_type}</span><span>{task.priority}</span><span>{task.story_points} pts</span></div>
            <ul>{task.acceptance_criteria?.map((item) => <li key={item}>{item}</li>)}</ul>
            <button className="ghost" onClick={() => createGenerated(task)}>Create in backlog</button>
          </article>)}</div>
          <h4>Risks</h4><ul className="risk-list">{breakdown.risks?.map((risk) => <li key={risk}>{risk}</li>)}</ul>
        </div>}
      </section>

      <section className="panel">
        <div className="panel-head wrap"><div><h3>Sprint planning AI</h3><span>Use backlog priority + capacity</span></div></div>
        <div className="inline-controls wrap">
          <select value={sprintId} onChange={(e) => setSprintId(e.target.value)}><option value="">Select sprint</option>{projectSprints.filter((s) => s.status !== 'COMPLETED').map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}</select>
          <input type="number" min="1" max="300" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          <button className="primary" onClick={runSprintPlan}>Suggest scope</button>
          <button className="ghost" onClick={runInsights}>Sprint insights</button>
        </div>
        {plan && <div className="ai-output"><p><strong>{plan.planned_points || 0}</strong> of <strong>{plan.capacity_points}</strong> capacity points selected.</p><div className="issue-list compact">{plan.selected_issues?.map((issue) => <IssueCompact key={issue.id} issue={issue} />)}</div><button className="primary" disabled={!sprintId || !plan.selected_issues?.length} onClick={addPlanToSprint}>Add selected scope to sprint</button></div>}
        {insights && <div className="insight-box">{insights.insights?.map((item) => <p key={item}>{item}</p>)}</div>}
      </section>
    </div>
  );
}
