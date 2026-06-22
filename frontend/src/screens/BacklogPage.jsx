import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import CreateTaskDrawer from '../components/CreateTaskDrawer.jsx';
import IssueList from '../components/IssueList.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';

export default function BacklogPage() {
  const { page, issues, backlogIssues, projectSprints, addIssuesToSprint, setSelectedIssue, taskDrawerOpen, taskDrawerDefaultStatus, closeCreateTaskDrawer, openCreateTaskDrawer, updateIssue, deleteIssue, session, members } = useWorkspace();
  const [selected, setSelected] = useState([]);
  const [targetSprint, setTargetSprint] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    priority: 'ALL',
    assignee: 'ALL',
    status: 'ALL',
    quick: 'ALL',
  });
  const plannedSprints = projectSprints.filter((sprint) => sprint.status !== 'COMPLETED');

  useEffect(() => {
    if (!targetSprint && plannedSprints[0]) setTargetSprint(plannedSprints[0].id);
  }, [plannedSprints, targetSprint]);

  const toggle = (issueId) => setSelected((current) => current.includes(issueId) ? current.filter((id) => id !== issueId) : [...current, issueId]);
  const addSelected = async () => { await addIssuesToSprint(targetSprint, selected); setSelected([]); };

  const backlogBase = useMemo(() => backlogIssues.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)), [backlogIssues]);
  const myTasksBase = useMemo(() => issues.filter((issue) => issue.assignee_id === session.user?.id || issue.reporter_id === session.user?.id), [issues, session.user?.id]);

  const filteredIssues = useMemo(() => {
    const base = page === 'my-tasks' ? myTasksBase : backlogBase;
    return base.filter((issue) => {
      const search = filters.search.trim().toLowerCase();
      if (search) {
        const haystack = [issue.issue_key, issue.title, issue.description, issue.assignee_name, issue.sprint_name, issue.project_key, issue.priority, issue.status]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      if (page === 'my-tasks') {
        if (filters.quick === 'ASSIGNED' && issue.assignee_id !== session.user?.id) return false;
        if (filters.quick === 'CREATED' && issue.reporter_id !== session.user?.id) return false;
        if (filters.quick === 'DUE_SOON') {
          if (!issue.due_date) return false;
          const today = new Date();
          const weekAhead = new Date();
          weekAhead.setDate(today.getDate() + 7);
          const due = new Date(issue.due_date);
          return due >= new Date(today.toDateString()) && due <= weekAhead;
        }
        if (filters.quick === 'HIGH' && !['HIGH', 'URGENT'].includes(issue.priority)) return false;
        if (filters.quick === 'OPEN' && issue.status === 'DONE') return false;
        if (filters.status === 'DONE' && issue.status !== 'DONE') return false;
        if (filters.status === 'OPEN' && issue.status === 'DONE') return false;
      }

      if (page !== 'my-tasks') {
        if (filters.priority !== 'ALL' && issue.priority !== filters.priority) return false;
        if (filters.assignee === 'UNASSIGNED' && issue.assignee_id) return false;
        if (filters.assignee !== 'ALL' && filters.assignee !== 'UNASSIGNED' && issue.assignee_id !== filters.assignee) return false;
        if (filters.status !== 'ALL' && issue.status !== filters.status) return false;
        if (filters.quick === 'UNASSIGNED' && issue.assignee_id) return false;
        if (filters.quick === 'HIGH' && !['HIGH', 'URGENT'].includes(issue.priority)) return false;
        if (filters.quick === 'NO_ESTIMATE' && Number(issue.story_points || 0) > 0) return false;
        if (filters.quick === 'RECENT') {
          const created = new Date(issue.created_at || 0);
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - 7);
          if (Number.isNaN(created.getTime()) || created < cutoff) return false;
        }
      }

      return true;
    });
  }, [backlogBase, filters, myTasksBase, page, session.user?.id]);

  const handleFilterChange = (patch) => setFilters((current) => ({ ...current, ...patch }));

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
      <IssueList
        mode={page === 'my-tasks' ? 'my-tasks' : 'backlog'}
        title={page === 'my-tasks' ? 'My Tasks' : 'Backlog'}
        description={page === 'my-tasks'
          ? 'Track work assigned to you or created by you in a compact issue list.'
          : 'Capture work that is not yet on the board, then pull it into a sprint when ready.'}
        items={filteredIssues}
        totalCount={page === 'my-tasks' ? myTasksBase.length : backlogBase.length}
        filters={filters}
        onFiltersChange={handleFilterChange}
        members={members}
        sprints={plannedSprints}
        selectedIds={selected}
        onToggleSelected={toggle}
        onClearSelection={() => setSelected([])}
        onOpenIssue={setSelectedIssue}
        onCreateTask={() => openCreateTaskDrawer('BACKLOG')}
        onAddSelectedToSprint={addSelected}
        targetSprintId={targetSprint}
        onTargetSprintChange={setTargetSprint}
        onUpdateIssue={updateIssue}
        onDeleteIssue={deleteIssue}
      />
      <CreateTaskDrawer
        open={taskDrawerOpen}
        onClose={closeCreateTaskDrawer}
        defaultStatus={taskDrawerDefaultStatus}
      />
    </div>
  );
}
