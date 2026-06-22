import { useEffect, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import MetricCard from '../components/MetricCard.jsx';
import Distribution from '../components/Distribution.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';

export default function ReportsPage() {
  const { dashboard, projectSprints, api, showError } = useWorkspace();
  const [sprintId, setSprintId] = useState('');
  const [sprintReport, setSprintReport] = useState(null);

  useEffect(() => {
    if (!sprintId) { setSprintReport(null); return; }
    api.get(`/reports/sprint/${sprintId}`).then(setSprintReport).catch(showError);
  }, [api, showError, sprintId]);

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Management view" title="Reports" description="Simple reporting for status, priority, workload, and sprint execution." />
      <div className="two-col">
        <section className="panel"><div className="panel-head"><h3>Status distribution</h3></div><Distribution items={dashboard?.status_distribution || []} labelKey="status" /></section>
        <section className="panel"><div className="panel-head"><h3>Priority distribution</h3></div><Distribution items={dashboard?.priority_distribution || []} labelKey="priority" /></section>
      </div>

      <section className="panel">
        <div className="panel-head wrap"><div><h3>Sprint report</h3><span>Select a sprint</span></div><select value={sprintId} onChange={(e) => setSprintId(e.target.value)}><option value="">Choose sprint</option>{projectSprints.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}</select></div>
        {sprintReport ? <div className="metric-grid small">
          <MetricCard label="Issues" value={sprintReport.summary?.total_issues || 0} helper="Total sprint scope" />
          <MetricCard label="Done" value={sprintReport.summary?.done_issues || 0} helper="Completed items" />
          <MetricCard label="Blocked" value={sprintReport.summary?.blocked_issues || 0} helper="Blocked scope" />
          <MetricCard label="Points" value={`${sprintReport.summary?.done_points || 0}/${sprintReport.summary?.total_points || 0}`} helper="Done / total" />
        </div> : <p className="muted">Choose a sprint to see report.</p>}
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Assignee workload</h3></div>
        <div className="workload-list">{(dashboard?.assignee_workload || []).map((item, index) => <div className="workload-row" key={item.id || index}><span>{item.name || 'Unassigned'}</span><strong>{item.issue_count} issues</strong><small>{item.story_points} pts</small></div>)}</div>
      </section>
    </div>
  );
}
