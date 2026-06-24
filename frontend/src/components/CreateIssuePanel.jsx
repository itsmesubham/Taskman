import { useEffect, useMemo, useRef, useState } from 'react';
import { ISSUE_STATUSES, PRIORITIES, STATUSES } from '../constants.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import AssigneePicker from './AssigneePicker.jsx';

const BOARD_STATUS_LABELS = {
  BACKLOG: 'Backlog',
  TODO: 'Todo',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'Review',
  DONE: 'Done'
};

function normalizeStatus(value) {
  if (!value) return 'TODO';
  if (value === 'REVIEW') return 'IN_REVIEW';
  return value;
}

function statusOptions(defaultStatus) {
  if (defaultStatus === 'BACKLOG') return ISSUE_STATUSES;
  return STATUSES.map((status) => status.key);
}

export default function CreateIssuePanel({
  open,
  onClose,
  defaultStatus = 'TODO',
  onCreated
}) {
  const { activeSprint, projectSprints, projects, projectRepositories, members, createIssue, sprintSchedule } = useWorkspace();
  const isOpen = Boolean(open);
  const [moreOpen, setMoreOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [status, setStatus] = useState(normalizeStatus(defaultStatus));
  const [assigneeQuery, setAssigneeQuery] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [sprintId, setSprintId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [storyPoints, setStoryPoints] = useState('');
  const [labels, setLabels] = useState('');
  const [aiPickable, setAiPickable] = useState(false);
  const [repositoryId, setRepositoryId] = useState('');
  const [githubBranch, setGithubBranch] = useState('');
  const titleRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setStatus(normalizeStatus(defaultStatus));
      setProjectId('');
      setAiPickable(false);
      setRepositoryId('');
      setGithubBranch('');
      window.requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [defaultStatus, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const filteredMembers = useMemo(() => {
    const query = assigneeQuery.trim().toLowerCase();
    if (!query) return members;
    return members.filter((member) => [member.name, member.email]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)));
  }, [assigneeQuery, members]);

  const assignee = useMemo(() => {
    const query = assigneeQuery.trim().toLowerCase();
    if (!query) return null;
    const exact = members.find((member) => [member.name, member.email, member.id]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase() === query));
    if (exact) return exact;
    return filteredMembers.length === 1 ? filteredMembers[0] : null;
  }, [assigneeQuery, filteredMembers, members]);

  const projectOptions = projects;
  const sprintOptions = useMemo(() => {
    if (!projectId) return [];
    return projectSprints.filter((sprint) => sprint.project_id === projectId && sprint.status !== 'COMPLETED');
  }, [projectId, projectSprints]);

  const projectRepoOptions = useMemo(() => {
    if (!projectId) return [];
    return projectRepositories.filter((repository) => repository.project_id === projectId && repository.status === 'ACTIVE');
  }, [projectId, projectRepositories]);

  const selectedRepository = useMemo(
    () => projectRepoOptions.find((repository) => repository.id === repositoryId) || null,
    [projectRepoOptions, repositoryId]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (!projectId) {
      setRepositoryId('');
      return;
    }
    if (selectedRepository && selectedRepository.project_id === projectId) return;
    const defaultRepository = projectRepoOptions.find((repository) => repository.is_default) || projectRepoOptions[0] || null;
    if (defaultRepository && (aiPickable || projectRepoOptions.length === 1)) {
      setRepositoryId(defaultRepository.id);
    } else if (!aiPickable) {
      setRepositoryId('');
    }
  }, [aiPickable, isOpen, projectId, projectRepoOptions, repositoryId, selectedRepository]);

  const hasUnsavedChanges = Boolean(
    title.trim() ||
    assigneeQuery.trim() ||
    description.trim() ||
    dueDate ||
    sprintId ||
    projectId ||
    storyPoints ||
    labels.trim() ||
    aiPickable ||
    repositoryId ||
    githubBranch.trim() ||
    moreOpen ||
    priority !== 'MEDIUM' ||
    status !== normalizeStatus(defaultStatus)
  );

  const close = () => onClose?.();
  const requestClose = () => {
    if (isSubmitting) return;
    if (hasUnsavedChanges && !window.confirm('Discard this task draft?')) return;
    reset();
    close();
  };

  const reset = () => {
    setTitle('');
    setPriority('MEDIUM');
    setStatus(normalizeStatus(defaultStatus));
    setAssigneeQuery('');
    setDescription('');
    setDueDate('');
    setSprintId('');
    setProjectId('');
    setStoryPoints('');
    setLabels('');
    setAiPickable(false);
    setRepositoryId('');
    setGithubBranch('');
    setMoreOpen(false);
  };

  const branchPreview = useMemo(() => {
    const projectKey = projectOptions.find((project) => project.id === projectId)?.key || 'PROJ';
    const repoPrefix = selectedRepository?.branch_prefix || 'ai/';
    const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task';
    return githubBranch.trim() || `${repoPrefix}${projectKey.toLowerCase()}/${slug}`;
  }, [githubBranch, projectId, projectOptions, selectedRepository?.branch_prefix, title]);

  const submit = async (event) => {
    event.preventDefault();
    if (!title.trim()) return;
    setIsSubmitting(true);
    try {
      const result = await createIssue({
        project_id: projectId || null,
        title: title.trim(),
        priority,
        status,
        assignee_id: assignee?.id || null,
        description: description.trim(),
        due_date: dueDate || null,
        sprint_id: sprintId || null,
        story_points: Number(storyPoints) || 0,
        labels: labels.split(',').map((item) => item.trim()).filter(Boolean),
        ai_pickable: aiPickable,
        repository_id: repositoryId || null,
        github_repo: selectedRepository?.repo || null,
        github_branch: githubBranch.trim() || null
      });
      if (result) {
        onCreated?.(result);
        reset();
        close();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="drawer-backdrop" onMouseDown={requestClose}>
      <aside className="create-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <p className="eyebrow">Create task</p>
            <h2>Quick task</h2>
            <p className="drawer-helper">Add the task, assign it, and push it to the board without leaving the page.</p>
          </div>
          <button type="button" className="icon-btn" onClick={requestClose}>×</button>
        </div>

        <form className="create-drawer-form" onSubmit={submit}>
          <label className="wide">
            Task title
            <input
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What needs to be done?"
              required
            />
          </label>

          <label>
            Assignee
            <AssigneePicker
              members={filteredMembers}
              value={assignee?.id || ''}
              query={assigneeQuery}
              onQueryChange={setAssigneeQuery}
            />
          </label>

          <label>
            Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              {PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>

          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {statusOptions(defaultStatus).map((item) => (
                <option key={item} value={item}>{BOARD_STATUS_LABELS[item] || item.replace('_', ' ')}</option>
              ))}
            </select>
          </label>

          <label className="toggle-row">
            <input type="checkbox" checked={aiPickable} onChange={(event) => setAiPickable(event.target.checked)} />
            <span>
              AI-pickable
              <small>Allow a coding agent to claim this task through the agent workflow.</small>
            </span>
          </label>

          <div className="form-actions drawer-actions">
            <button type="button" className="ghost" onClick={() => setMoreOpen((current) => !current)}>
              {moreOpen ? 'Hide details' : 'More details'}
            </button>
            <button type="submit" className="primary" disabled={isSubmitting || !title.trim()}>{isSubmitting ? 'Creating...' : 'Create'}</button>
          </div>

          {moreOpen && (
            <div className="drawer-more">
              <label>
                Project
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">{sprintSchedule?.defaultProject?.name || 'Use default project'}</option>
                  {projectOptions.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}
                </select>
              </label>
              <label>
                Sprint
                <select value={sprintId} onChange={(event) => setSprintId(event.target.value)}>
                  <option value="">{activeSprint && (!projectId || activeSprint.project_id === projectId) ? `Current sprint: ${activeSprint.name}` : 'Auto monthly sprint'}</option>
                  {sprintOptions.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}
                </select>
              </label>
              <label>
                Repository
                <select value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
                  <option value="">No repository</option>
                  {projectRepoOptions.map((repository) => (
                    <option key={repository.id} value={repository.id}>
                      {repository.repo} · {repository.provider}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Branch
                <input value={githubBranch} onChange={(event) => setGithubBranch(event.target.value)} placeholder="ai/taskman-123-fix-login" />
                <small className="field-help">Preview: {branchPreview}</small>
              </label>
              <label>
                Due date
                <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </label>
              <label>
                Story points
                <input type="number" min="0" max="100" value={storyPoints} onChange={(event) => setStoryPoints(event.target.value)} />
              </label>
              <label className="wide">
                Description
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add context, acceptance criteria, or dependencies" />
              </label>
              <label className="wide">
                Labels
                <input value={labels} onChange={(event) => setLabels(event.target.value)} placeholder="frontend, urgent, customer" />
              </label>
            </div>
          )}
        </form>
      </aside>
    </div>
  );
}
