import { useEffect, useMemo, useState } from 'react';
import ActivityList from './ActivityList.jsx';
import IssueMetaBadge from './IssueMetaBadge.jsx';
import ProjectBadge from './ProjectBadge.jsx';
import PriorityBadge from './PriorityBadge.jsx';
import StatusPill from './StatusPill.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { ISSUE_TYPES, PRIORITIES, STATUSES } from '../constants.js';
import { formatDate } from '../utils.js';
import { getTaskUrl } from '../utils/taskRoutes.js';
import { getBoardWorkflowStatus, getTaskStateBadges } from '../utils/taskWorkflow.js';

const TAB_DEFS = [
  { key: 'overview', label: 'Overview' },
  { key: 'agent', label: 'Agent / PR' },
  { key: 'activity', label: 'Activity' },
  { key: 'comments', label: 'Comments' },
];

function TaskPropertyRow({ label, children, muted = false }) {
  return (
    <div className="task-property-row">
      <span>{label}</span>
      <div className={muted ? 'muted' : ''}>{children}</div>
    </div>
  );
}

function TaskSection({ title, description, action, children, emptyState }) {
  return (
    <section className="task-section panel">
      <div className="panel-head wrap">
        <div>
          <h3>{title}</h3>
          {description ? <span>{description}</span> : null}
        </div>
        {action}
      </div>
      {children}
      {!children && emptyState}
    </section>
  );
}

function extractChecklistItems(text, heading) {
  const lines = String(text || '').split('\n');
  const target = `## ${heading}`.toLowerCase();
  let active = false;
  const items = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^##\s+/.test(line)) {
      active = line.toLowerCase() === target;
      continue;
    }
    if (!active) continue;
    const match = line.match(/^- \[( |x)\]\s+(.*)$/i);
    if (match) {
      items.push({ checked: match[1].toLowerCase() === 'x', text: match[2] });
    }
  }
  return items;
}

function appendChecklistItem(text, heading, itemLabel) {
  const body = String(text || '').trimEnd();
  const headingLine = `## ${heading}`;
  if (!body) {
    return `${headingLine}\n- [ ] ${itemLabel}`;
  }
  if (body.toLowerCase().includes(headingLine.toLowerCase())) {
    return `${body}\n- [ ] ${itemLabel}`;
  }
  return `${body}\n\n${headingLine}\n- [ ] ${itemLabel}`;
}

export default function TaskDetailPage() {
  const {
    selectedIssue,
    comments,
    issueActivity,
    agentActivity,
    addComment,
    updateIssue,
    deleteIssue,
    members,
    projectSprints,
    projects,
    projectRepositories,
    session,
    navigate,
    setPage,
    showSuccess,
    showError,
  } = useWorkspace();

  const [activeTab, setActiveTab] = useState('overview');
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [descriptionEditing, setDescriptionEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [draftIssue, setDraftIssue] = useState(null);

  useEffect(() => {
    if (!selectedIssue) return;
    setDraftIssue(selectedIssue);
    setTitleDraft(selectedIssue.title || '');
    setDescriptionDraft(selectedIssue.description || '');
    setDescriptionEditing(false);
    setActiveTab('overview');
  }, [selectedIssue?.id]);

  useEffect(() => {
    if (!selectedIssue) return undefined;
    document.title = `${selectedIssue.issue_key} · ${selectedIssue.title} · Taskman`;
    return () => {
      document.title = 'Taskman';
    };
  }, [selectedIssue?.id, selectedIssue?.issue_key, selectedIssue?.title]);

  const issue = draftIssue || selectedIssue;

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === issue?.project_id) || null,
    [projects, issue?.project_id]
  );

  const sprintOptions = useMemo(() => {
    if (!issue?.project_id) return [];
    return projectSprints.filter((sprint) => sprint.project_id === issue.project_id && sprint.status !== 'COMPLETED');
  }, [issue?.project_id, projectSprints]);

  const projectRepoOptions = useMemo(() => {
    if (!issue?.project_id) return [];
    return projectRepositories.filter((repository) => repository.project_id === issue.project_id && repository.status === 'ACTIVE');
  }, [issue?.project_id, projectRepositories]);

  const selectedRepository = useMemo(
    () => projectRepoOptions.find((repository) => repository.id === issue?.repository_id) || null,
    [issue?.repository_id, projectRepoOptions]
  );

  const workflowStatus = getBoardWorkflowStatus(issue);
  const taskBadges = getTaskStateBadges(issue);
  const taskUrl = getTaskUrl(issue, session.tenant);
  const canShowAgentTab = Boolean(issue?.ai_pickable || issue?.repository_id || issue?.github_repo || issue?.github_pr_url || issue?.github_pr_status || issue?.claimed_by_agent || issue?.agent_status || issue?.agent_summary || issue?.agent_test_notes || issue?.agent_blocker_reason || issue?.status === 'BLOCKED');
  const lastAgentUpdate = agentActivity[0] || null;
  const acceptanceItems = useMemo(() => extractChecklistItems(descriptionDraft, 'Acceptance criteria'), [descriptionDraft]);
  const subtaskItems = useMemo(() => extractChecklistItems(descriptionDraft, 'Subtasks'), [descriptionDraft]);
  const descriptionPreview = useMemo(() => {
    const text = String(descriptionDraft || '').trim();
    if (!text) return '';
    return text
      .split('\n')
      .filter((line) => !/^##\s+/.test(line.trim()))
      .join('\n')
      .trim();
  }, [descriptionDraft]);
  const reviewLabel = String(issue?.github_pr_status || '').toUpperCase() === 'CHANGES_REQUESTED'
    ? 'Changes requested'
    : String(issue?.github_pr_status || '').toUpperCase() === 'MERGED'
      ? 'PR merged'
      : String(issue?.github_pr_status || '').toUpperCase() === 'OPEN'
        ? 'PR open'
        : issue?.github_pr_url
          ? 'Needs review'
          : 'Not linked';

  if (!selectedIssue) return null;

  const commitPatch = async (patch) => {
    setSaving(true);
    setDraftIssue((current) => (current ? { ...current, ...patch } : current));
    try {
      await updateIssue(selectedIssue.id, patch, { silent: true });
    } finally {
      setSaving(false);
    }
  };

  const saveTitle = async () => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle || nextTitle === selectedIssue.title) {
      setTitleDraft(selectedIssue.title || '');
      return;
    }
    setDraftIssue((current) => (current ? { ...current, title: nextTitle } : current));
    await commitPatch({ title: nextTitle });
  };

  const saveDescription = async () => {
    setDraftIssue((current) => (current ? { ...current, description: descriptionDraft } : current));
    await commitPatch({ description: descriptionDraft });
    setDescriptionEditing(false);
  };

  const openTask = async () => {
    navigate(taskUrl);
  };

  const copyTaskLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${taskUrl}`);
      showSuccess('Copied');
    } catch {
      showError(new Error('Unable to copy task link'));
    }
  };

  const setStatus = async (status) => {
    setDraftIssue((current) => (current ? { ...current, status } : current));
    await commitPatch({ status });
  };

  const setPriority = async (priority) => {
    setDraftIssue((current) => (current ? { ...current, priority } : current));
    await commitPatch({ priority });
  };

  const setAssignee = async (assigneeId) => {
    setDraftIssue((current) => (current ? { ...current, assignee_id: assigneeId || null } : current));
    await commitPatch({ assignee_id: assigneeId || null });
  };

  const setProject = async (projectId) => {
    setDraftIssue((current) => (current ? { ...current, project_id: projectId || null } : current));
    await commitPatch({ project_id: projectId || null });
  };

  const setSprint = async (sprintId) => {
    setDraftIssue((current) => (current ? { ...current, sprint_id: sprintId || null } : current));
    await commitPatch({ sprint_id: sprintId || null });
  };

  const setType = async (issueType) => {
    setDraftIssue((current) => (current ? { ...current, issue_type: issueType } : current));
    await commitPatch({ issue_type: issueType });
  };

  const setPoints = async (points) => {
    setDraftIssue((current) => (current ? { ...current, story_points: Number(points) || 0 } : current));
    await commitPatch({ story_points: Number(points) || 0 });
  };

  const setDueDate = async (dueDate) => {
    setDraftIssue((current) => (current ? { ...current, due_date: dueDate || null } : current));
    await commitPatch({ due_date: dueDate || null });
  };

  const setAiPickable = async (checked) => {
    setDraftIssue((current) => (current ? { ...current, ai_pickable: checked } : current));
    await commitPatch({ ai_pickable: checked });
  };

  const setRepository = async (repositoryId) => {
    const repository = projectRepoOptions.find((item) => item.id === repositoryId) || null;
    setDraftIssue((current) => (current ? { ...current, repository_id: repositoryId || null, github_repo: repository?.repo || null } : current));
    await commitPatch({ repository_id: repositoryId || null, github_repo: repository?.repo || null });
  };

  const setBranch = async (branch) => {
    setDraftIssue((current) => (current ? { ...current, github_branch: branch } : current));
    await commitPatch({ github_branch: branch });
  };

  const setPrUrl = async (url) => {
    setDraftIssue((current) => (current ? { ...current, github_pr_url: url } : current));
    await commitPatch({ github_pr_url: url });
  };

  const setPrNumber = async (number) => {
    setDraftIssue((current) => (current ? { ...current, github_pr_number: number ? Number(number) : null } : current));
    await commitPatch({ github_pr_number: number ? Number(number) : null });
  };

  const setPrStatus = async (status) => {
    setDraftIssue((current) => (current ? { ...current, github_pr_status: status } : current));
    await commitPatch({ github_pr_status: status });
  };

  const setAgentSummary = async (text) => {
    setDraftIssue((current) => (current ? { ...current, agent_summary: text } : current));
    await commitPatch({ agent_summary: text });
  };

  const setTestNotes = async (text) => {
    setDraftIssue((current) => (current ? { ...current, agent_test_notes: text } : current));
    await commitPatch({ agent_test_notes: text });
  };

  const setBlockerReason = async (text) => {
    setDraftIssue((current) => (current ? { ...current, agent_blocker_reason: text } : current));
    await commitPatch({ agent_blocker_reason: text });
  };

  const addChecklistItem = async (heading, label) => {
    const next = appendChecklistItem(descriptionDraft, heading, label);
    setDescriptionDraft(next);
    await commitPatch({ description: next });
    setDescriptionEditing(true);
  };

  const requestChanges = async () => {
    setDraftIssue((current) => (current ? { ...current, status: 'CHANGES_REQUESTED', github_pr_status: 'CHANGES_REQUESTED' } : current));
    await commitPatch({ status: 'CHANGES_REQUESTED', github_pr_status: 'CHANGES_REQUESTED' });
  };

  const markBlocked = async () => {
    const blockerReason = descriptionDraft || issue?.agent_blocker_reason || 'Blocked by dependency or review';
    setDraftIssue((current) => (current ? { ...current, status: 'BLOCKED', agent_blocker_reason: blockerReason } : current));
    await commitPatch({ status: 'BLOCKED', agent_blocker_reason: blockerReason });
  };

  const clearBlocked = async () => {
    setDraftIssue((current) => (current ? { ...current, status: 'IN_PROGRESS', agent_blocker_reason: '' } : current));
    await commitPatch({ status: 'IN_PROGRESS', agent_blocker_reason: '' });
  };

  const releaseClaim = async () => {
    setDraftIssue((current) => (current ? { ...current, claimed_by_agent: null, agent_status: 'RELEASED', claim_expires_at: null } : current));
    await commitPatch({ claimed_by_agent: null, agent_status: 'RELEASED', claim_expires_at: null });
  };

  const moveToReview = async () => {
    setDraftIssue((current) => (current ? { ...current, status: 'IN_REVIEW' } : current));
    await commitPatch({ status: 'IN_REVIEW' });
  };

  const attachPr = async () => {
    if (!issue?.github_pr_url) return;
    setDraftIssue((current) => (current ? { ...current, status: 'IN_REVIEW', github_pr_status: current.github_pr_status || 'OPEN' } : current));
    await commitPatch({
      status: 'IN_REVIEW',
      github_pr_status: issue.github_pr_status || 'OPEN',
      github_pr_url: issue.github_pr_url,
      github_pr_number: issue.github_pr_number || null,
    });
  };

  const moreMenu = (
    <details className="task-more-menu" open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)}>
      <summary className="ghost tiny">More</summary>
      <div className="task-more-menu-panel" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="ghost" onClick={copyTaskLink}>Copy link</button>
        <button type="button" className="ghost" onClick={openTask}>Open full page</button>
        <button type="button" className="danger" onClick={() => {
          setMoreOpen(false);
          deleteIssue(selectedIssue.id);
        }}>
          Delete
        </button>
      </div>
    </details>
  );

  return (
    <article className="task-detail-page">
      <header className="task-detail-header">
        <div className="task-breadcrumb">
          <span>{session.tenant?.name || 'Workspace'}</span>
          <span>/</span>
          <span>{selectedProject?.key || issue.project_key || 'Project'}</span>
          <span>/</span>
          <span>{issue.issue_key}</span>
        </div>
        <div className="task-header-main">
          <div className="task-header-copy">
            <span className="issue-key-big">{issue.issue_key}</span>
            <input
              className="task-title-input"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={saveTitle}
              aria-label="Task title"
            />
            <div className="task-header-badges">
              <ProjectBadge projectKey={issue.project_key} />
              {issue.sprint_name ? <IssueMetaBadge type="points" value={issue.sprint_name} className="sprint-badge" /> : null}
              <PriorityBadge priority={issue.priority} />
              <IssueMetaBadge type="status" value={workflowStatus} />
              {issue.assignee_name ? <IssueMetaBadge type="points" value={issue.assignee_name} /> : null}
              {issue.github_pr_status ? <IssueMetaBadge type="points" value={reviewLabel} className="repo-badge" /> : null}
              {taskBadges.map((badge) => <span key={badge.label} className={`issue-badge task-badge ${badge.tone}`}>{badge.label}</span>)}
            </div>
          </div>
          <div className="task-header-actions">
            <span className="saving-indicator">{saving ? 'Saving…' : 'Saved'}</span>
            <button type="button" className="ghost tiny" onClick={copyTaskLink}>Copy link</button>
            <button type="button" className="ghost tiny" onClick={() => { navigate('/'); setPage('board'); }}>Back to board</button>
            {moreMenu}
          </div>
        </div>
      </header>

      <div className="task-detail-tabs" role="tablist" aria-label="Task detail tabs">
        {TAB_DEFS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={activeTab === tab.key ? 'active' : ''}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="task-detail-layout">
        <main className="task-detail-main">
          {activeTab === 'overview' && (
            <>
              <section className="panel task-section">
                <div className="panel-head wrap">
                  <div>
                    <h3>Description</h3>
                    <span>Add context, reproduction steps, implementation notes, or expected behavior.</span>
                  </div>
                  <div className="panel-head-actions">
                    {descriptionEditing ? (
                      <>
                        <button type="button" className="ghost tiny" onClick={() => { setDescriptionDraft(issue.description || ''); setDescriptionEditing(false); }}>Cancel</button>
                        <button type="button" className="primary tiny" onClick={saveDescription}>Save</button>
                      </>
                    ) : (
                      <button type="button" className="ghost tiny" onClick={() => setDescriptionEditing(true)}>Edit</button>
                    )}
                  </div>
                </div>
                {descriptionEditing ? (
                  <textarea
                    className="task-description-editor"
                    value={descriptionDraft}
                    onChange={(event) => setDescriptionDraft(event.target.value)}
                    placeholder="Add context, reproduction steps, implementation notes, or expected behavior."
                  />
                ) : descriptionPreview ? (
                  <div className="task-description-preview">
                    {descriptionPreview.split('\n').map((line, index) => (
                      <p key={`${line}-${index}`}>{line}</p>
                    ))}
                  </div>
                ) : (
                  <div className="empty-inline task-empty-inline">
                    <h4>No description yet</h4>
                    <p>Add context, reproduction steps, implementation notes, or expected behavior.</p>
                    <button type="button" className="ghost tiny" onClick={() => setDescriptionEditing(true)}>Add description</button>
                  </div>
                )}
              </section>

              <section className="panel task-section">
                <div className="panel-head wrap">
                  <div>
                    <h3>Acceptance criteria</h3>
                    <span>Track the outcome the task needs to satisfy.</span>
                  </div>
                  <button type="button" className="ghost tiny" onClick={() => addChecklistItem('Acceptance criteria', 'Add a clear acceptance criterion')}>
                    Add criterion
                  </button>
                </div>
                {acceptanceItems.length ? (
                  <div className="task-checklist">
                    {acceptanceItems.map((item, index) => (
                      <label key={`${item.text}-${index}`} className="task-checklist-item">
                        <input type="checkbox" checked={item.checked} readOnly />
                        <span>{item.text}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="empty-inline task-empty-inline">
                    <p>No acceptance criteria yet.</p>
                  </div>
                )}
              </section>

              <section className="panel task-section">
                <div className="panel-head wrap">
                  <div>
                    <h3>Subtasks</h3>
                    <span>Break the work into smaller pieces when needed.</span>
                  </div>
                  <button type="button" className="ghost tiny" onClick={() => addChecklistItem('Subtasks', 'Add a subtask')}>
                    Add subtask
                  </button>
                </div>
                {subtaskItems.length ? (
                  <div className="task-checklist">
                    {subtaskItems.map((item, index) => (
                      <label key={`${item.text}-${index}`} className="task-checklist-item">
                        <input type="checkbox" checked={item.checked} readOnly />
                        <span>{item.text}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="empty-inline task-empty-inline">
                    <p>No subtasks yet.</p>
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === 'agent' && (
            <>
              <section className="panel task-section">
                <div className="panel-head wrap">
                  <div>
                    <h3>Agent status</h3>
                    <span>AI-agent execution data and safe workflow controls.</span>
                  </div>
                  <div className="drawer-badges">
                    {taskBadges.map((badge) => <span key={badge.label} className={`issue-badge task-badge ${badge.tone}`}>{badge.label}</span>)}
                  </div>
                </div>
                {!canShowAgentTab ? (
                  <div className="empty-inline task-empty-inline">
                    <h4>No agent data yet</h4>
                    <p>Mark this task AI-pickable or attach a repository to enable coding-agent workflows.</p>
                    <button type="button" className="ghost tiny" onClick={() => setAiPickable(true)}>Mark AI-pickable</button>
                  </div>
                ) : (
                  <div className="task-property-grid">
                    <TaskPropertyRow label="AI-pickable">
                      <label className="toggle-row compact">
                        <input type="checkbox" checked={Boolean(issue.ai_pickable)} onChange={(event) => setAiPickable(event.target.checked)} />
                        <span>{issue.ai_pickable ? 'Enabled' : 'Disabled'}</span>
                      </label>
                    </TaskPropertyRow>
                    <TaskPropertyRow label="Agent status">{issue.agent_status || 'AVAILABLE'}</TaskPropertyRow>
                    <TaskPropertyRow label="Claimed by">{issue.claimed_by_agent || 'Not claimed'}</TaskPropertyRow>
                    <TaskPropertyRow label="Claim expires">{issue.claim_expires_at ? formatDate(issue.claim_expires_at) : 'Not set'}</TaskPropertyRow>
                    <TaskPropertyRow label="Last update">{lastAgentUpdate ? `${lastAgentUpdate.actor_name || lastAgentUpdate.actor_kind || 'Agent'} · ${lastAgentUpdate.message}` : 'No agent activity yet.'}</TaskPropertyRow>
                    <TaskPropertyRow label="Agent summary">
                      <textarea
                        className="inline-textarea"
                        value={issue.agent_summary || ''}
                        onChange={(event) => setAgentSummary(event.target.value)}
                        placeholder="Short summary from the agent"
                      />
                    </TaskPropertyRow>
                    <TaskPropertyRow label="Test notes">
                      <textarea
                        className="inline-textarea"
                        value={issue.agent_test_notes || ''}
                        onChange={(event) => setTestNotes(event.target.value)}
                        placeholder="What was tested and how"
                      />
                    </TaskPropertyRow>
                  </div>
                )}
              </section>

              <section className="panel task-section">
                <div className="panel-head wrap">
                  <div>
                    <h3>Repository and branch</h3>
                    <span>Choose the repository and preview the branch name for the agent or PR.</span>
                  </div>
                </div>
                <div className="task-property-grid">
                  <TaskPropertyRow label="Repository">
                    <select value={issue.repository_id || ''} onChange={(event) => setRepository(event.target.value)}>
                      <option value="">No repository selected</option>
                      {projectRepoOptions.map((repository) => (
                        <option key={repository.id} value={repository.id}>
                          {repository.repo} · {repository.provider}
                        </option>
                      ))}
                    </select>
                  </TaskPropertyRow>
                  <TaskPropertyRow label="Branch">
                    <input
                      value={issue.github_branch || ''}
                      onChange={(event) => setBranch(event.target.value)}
                      placeholder="ai/grabbit/grabbit-3"
                    />
                  </TaskPropertyRow>
                  <TaskPropertyRow label="Branch preview">
                    <span className="muted">{issue.github_branch || `${selectedRepository?.branch_prefix || 'ai/'}${(issue.project_key || selectedProject?.key || 'PROJ').toLowerCase()}/${issue.issue_key.toLowerCase()}`}</span>
                  </TaskPropertyRow>
                </div>
              </section>

              <section className="panel task-section">
                <div className="panel-head wrap">
                  <div>
                    <h3>Pull request</h3>
                    <span>Link the GitHub PR tied to this task.</span>
                  </div>
                  {issue.github_pr_url ? <button type="button" className="ghost tiny" onClick={() => window.open(issue.github_pr_url, '_blank', 'noopener,noreferrer')}>Open PR</button> : null}
                </div>
                {issue.github_pr_url ? (
                  <div className="task-pr-card">
                    <div className="task-pr-card-head">
                      <div>
                        <strong>{selectedRepository?.repo || issue.github_repo || 'No repository'}</strong>
                        <span>{issue.github_branch || 'Branch not set'}</span>
                      </div>
                      <div className="drawer-badges">
                        <StatusPill status={workflowStatus} />
                        <IssueMetaBadge type="status" value={reviewLabel} />
                      </div>
                    </div>
                    <div className="task-pr-card-meta">
                      <IssueMetaBadge type="points" value={`PR #${issue.github_pr_number || '—'}`} />
                      <IssueMetaBadge type="points" value={issue.github_pr_status || 'OPEN'} />
                    </div>
                    <div className="task-pr-card-actions">
                      <button type="button" className="ghost tiny" onClick={attachPr}>Attach PR</button>
                      <button type="button" className="ghost tiny" onClick={requestChanges}>Request changes</button>
                    </div>
                  </div>
                ) : (
                  <div className="empty-inline task-empty-inline">
                    <h4>No pull request linked yet.</h4>
                    <p>When an agent submits work, the PR link will appear here.</p>
                    <button type="button" className="ghost tiny" onClick={attachPr} disabled={!issue.github_pr_url}>
                      Attach PR
                    </button>
                  </div>
                )}
                <div className="task-property-grid">
                  <TaskPropertyRow label="PR URL">
                    <input value={issue.github_pr_url || ''} onChange={(event) => setPrUrl(event.target.value)} placeholder="https://github.com/owner/repo/pull/123" />
                  </TaskPropertyRow>
                  <TaskPropertyRow label="PR number">
                    <input type="number" min="1" value={issue.github_pr_number || ''} onChange={(event) => setPrNumber(event.target.value)} />
                  </TaskPropertyRow>
                  <TaskPropertyRow label="PR status">
                    <input value={issue.github_pr_status || ''} onChange={(event) => setPrStatus(event.target.value)} placeholder="OPEN, MERGED, CI_FAILED" />
                  </TaskPropertyRow>
                </div>
                <div className="agent-pr-actions">
                  <button type="button" className="ghost" onClick={() => setAiPickable(true)}>Mark AI-pickable</button>
                  <button type="button" className="ghost" onClick={releaseClaim}>Release agent claim</button>
                  <button type="button" className="ghost" onClick={moveToReview}>Move to Review</button>
                  <button type="button" className="ghost" onClick={markBlocked}>Mark blocked</button>
                  <button type="button" className="ghost" onClick={requestChanges}>Request changes</button>
                  <button type="button" className="primary" onClick={attachPr} disabled={!issue.github_pr_url}>Attach PR</button>
                  {issue.status === 'BLOCKED' ? <button type="button" className="ghost" onClick={clearBlocked}>Clear blocked</button> : null}
                </div>
              </section>
            </>
          )}

          {activeTab === 'activity' && (
            <section className="panel task-section">
              <div className="panel-head wrap">
                <div>
                  <h3>Activity</h3>
                  <span>Audit trail for status, assignee, sprint, PR, and agent changes.</span>
                </div>
              </div>
              <ActivityList items={issueActivity} />
            </section>
          )}

          {activeTab === 'comments' && (
            <section className="panel task-section">
              <div className="panel-head wrap">
                <div>
                  <h3>Comments</h3>
                  <span>Focused discussion for this task.</span>
                </div>
              </div>
                <div className="comment-list">
                {comments.map((item) => (
                  <div className="comment" key={item.id}>
                    <strong>{item.author_name || 'User'}</strong>
                    <p>{item.body}</p>
                    <small>{formatDate(item.created_at)}</small>
                  </div>
                ))}
                {!comments.length && <p className="muted">No comments yet.</p>}
              </div>
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (comment.trim()) {
                    await addComment(selectedIssue.id, comment);
                      setComment('');
                    }
                  }}
                  className="task-comment-form"
                >
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a useful update for the team" />
                <button className="primary" disabled={!comment.trim()}>Add comment</button>
              </form>
            </section>
          )}
        </main>

        <aside className="task-detail-sidebar">
          <section className="panel task-sidebar-card">
            <div className="panel-head wrap">
              <div>
                <h3>Properties</h3>
                <span>Compact issue fields and metadata.</span>
              </div>
              <StatusPill status={workflowStatus} />
            </div>
            <div className="task-sidebar-grid">
              <TaskPropertyRow label="Status">
                <select value={issue.status || 'TODO'} onChange={(event) => setStatus(event.target.value)}>
                  {STATUSES.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}
                </select>
              </TaskPropertyRow>
              <TaskPropertyRow label="Assignee">
                <select value={issue.assignee_id || ''} onChange={(event) => setAssignee(event.target.value)}>
                  <option value="">Unassigned</option>
                  {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              </TaskPropertyRow>
              <TaskPropertyRow label="Priority">
                <select value={issue.priority || 'MEDIUM'} onChange={(event) => setPriority(event.target.value)}>
                  {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                </select>
              </TaskPropertyRow>
              <TaskPropertyRow label="Project">
                <select value={issue.project_id || ''} onChange={(event) => setProject(event.target.value)}>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}
                </select>
              </TaskPropertyRow>
              <TaskPropertyRow label="Sprint">
                <select value={issue.sprint_id || ''} onChange={(event) => setSprint(event.target.value)}>
                  <option value="">No sprint</option>
                  {sprintOptions.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}
                </select>
              </TaskPropertyRow>
              <TaskPropertyRow label="Type">
                <select value={issue.issue_type || 'TASK'} onChange={(event) => setType(event.target.value)}>
                  {ISSUE_TYPES.map((issueType) => <option key={issueType} value={issueType}>{issueType}</option>)}
                </select>
              </TaskPropertyRow>
              <TaskPropertyRow label="Story points">
                <input type="number" min="0" max="100" value={issue.story_points || 0} onChange={(event) => setPoints(event.target.value)} />
              </TaskPropertyRow>
              <TaskPropertyRow label="Due date">
                <input type="date" value={issue.due_date || ''} onChange={(event) => setDueDate(event.target.value)} />
              </TaskPropertyRow>
              <TaskPropertyRow label="Reporter">{issue.reporter_name || 'System'}</TaskPropertyRow>
              <TaskPropertyRow label="Created">{formatDate(issue.created_at)}</TaskPropertyRow>
              <TaskPropertyRow label="Updated">{formatDate(issue.updated_at)}</TaskPropertyRow>
            </div>
          </section>

          {issue.status === 'BLOCKED' || issue.agent_blocker_reason ? (
            <section className="panel task-sidebar-card">
              <div className="panel-head wrap">
                <div>
                  <h3>Blocker</h3>
                  <span>Why this task is blocked.</span>
                </div>
                <IssueMetaBadge type="status" value="Blocked" />
              </div>
              <textarea
                className="inline-textarea"
                value={issue.agent_blocker_reason || ''}
                onChange={(event) => setBlockerReason(event.target.value)}
                placeholder="Blocked by dependency or review"
              />
            </section>
          ) : null}

          <section className="panel task-sidebar-card">
            <div className="panel-head wrap">
              <div>
                <h3>Short summary</h3>
                <span>Key context at a glance.</span>
              </div>
            </div>
            <div className="task-sidebar-summary">
              <div><span>Project</span><strong>{issue.project_key || selectedProject?.key || 'Not set'}</strong></div>
              <div><span>Repository</span><strong>{selectedRepository?.repo || issue.github_repo || 'Not set'}</strong></div>
              <div><span>Branch</span><strong>{issue.github_branch || 'Not set'}</strong></div>
              <div><span>PR</span><strong>{issue.github_pr_url ? `#${issue.github_pr_number || '—'}` : 'Not linked'}</strong></div>
            </div>
          </section>
        </aside>
      </div>
    </article>
  );
}
