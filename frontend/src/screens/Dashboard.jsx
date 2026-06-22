import PageHeader from '../components/PageHeader.jsx';
import MetricCard from '../components/MetricCard.jsx';
import ActivityList from '../components/ActivityList.jsx';
import Distribution from '../components/Distribution.jsx';
import { STATUSES } from '../constants.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { metricValue } from '../utils.js';

export default function Dashboard() {
  const { dashboard, activeSprint, backlogIssues, boardIssues, activeProject } = useWorkspace();
  const summary = dashboard?.summary || {};
  const cards = [
    ['Projects', metricValue(summary.total_projects), 'Active spaces inside this tenant'],
    ['Open issues', Math.max(metricValue(summary.total_issues) - metricValue(summary.done_issues), 0), 'Everything not done'],
    ['Blocked', metricValue(summary.blocked_issues), 'Needs attention'],
    ['High priority', metricValue(summary.high_priority_issues), 'High and urgent issues'],
    ['Done points', `${metricValue(summary.done_points)}/${metricValue(summary.total_points)}`, 'Story point progress'],
    ['Backlog', backlogIssues.length, 'Unplanned work']
  ];
  const boardDistribution = STATUSES.map((status) => ({ status: status.label, count: boardIssues.filter((issue) => issue.status === status.key).length }));

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Command center" title={activeProject ? `${activeProject.name} dashboard` : 'Tenant dashboard'} description="Track delivery health, sprint execution, workload, blockers, and recent activity." />
      <div className="metric-grid">{cards.map(([label, value, helper]) => <MetricCard key={label} label={label} value={value} helper={helper} />)}</div>

      <div className="two-col">
        <section className="panel">
          <div className="panel-head"><h3>Active sprint</h3><span>{activeSprint?.name || 'No active sprint'}</span></div>
          {activeSprint ? <>
            <div className="progress-line"><span style={{ width: `${activeSprint.issue_count ? Math.round((activeSprint.done_count / activeSprint.issue_count) * 100) : 0}%` }} /></div>
            <div className="sprint-summary-row"><strong>{activeSprint.done_count || 0}/{activeSprint.issue_count || 0}</strong><span>issues done</span></div>
            <p className="muted">{activeSprint.goal || 'No goal added yet.'}</p>
          </> : <p className="muted">Create and start a sprint from the Sprints page.</p>}
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Recent activity</h3><span>{dashboard?.recent_activity?.length || 0} events</span></div>
          <ActivityList items={dashboard?.recent_activity || []} />
        </section>
      </div>

      <section className="panel">
        <div className="panel-head"><h3>Board snapshot</h3><span>{boardIssues.length} board issues</span></div>
        <Distribution items={boardDistribution} labelKey="status" />
      </section>
    </div>
  );
}
