import { formatDate } from '../utils.js';

export default function SprintScheduleCard({ sprintSchedule }) {
  const jumpTo = (id) => {
    window.document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section className="panel auto-sprint-card">
      <div className="panel-head wrap">
        <div>
          <h3>Auto Sprint Schedule</h3>
          <span>Taskman automatically creates one sprint every month for this workspace.</span>
        </div>
        <span className="status-badge success">{sprintSchedule?.autoSprintEnabled ? 'Enabled' : 'Disabled'}</span>
      </div>
      <div className="schedule-grid">
        <div><small>Auto Sprint</small><strong>{sprintSchedule?.autoSprintEnabled ? 'Enabled' : 'Disabled'}</strong></div>
        <div><small>Frequency</small><strong>{sprintSchedule?.frequency || 'Monthly'}</strong></div>
        <div><small>Current Sprint</small><strong>{sprintSchedule?.currentSprint?.name || 'Current sprint'}</strong></div>
        <div><small>Next Sprint</small><strong>{sprintSchedule?.nextSprintName || 'Next month'}</strong></div>
        <div className="wide"><small>Scheduled for</small><strong>{sprintSchedule?.nextCreationDate ? formatDate(sprintSchedule.nextCreationDate) : '1st of next month'}</strong></div>
        <div className="wide"><small>Last auto-created sprint</small><strong>{sprintSchedule?.lastCreatedSprint?.name || 'None yet'}</strong></div>
      </div>
      <div className="schedule-actions">
        <button type="button" className="ghost" onClick={() => jumpTo('current-sprints')}>View Current Sprint</button>
        <button type="button" className="ghost" onClick={() => jumpTo('upcoming-sprints')}>View Upcoming Sprints</button>
      </div>
    </section>
  );
}
