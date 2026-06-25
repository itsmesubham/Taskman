import { useEffect, useMemo, useState } from 'react';
import { ISSUE_TYPES, PRIORITIES, STATUSES } from '../constants.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { formatDate } from '../utils.js';
import { getTaskUrl } from '../utils/taskRoutes.js';
import { getBoardWorkflowStatus, getTaskStateBadges } from '../utils/taskWorkflow.js';
import TaskDetailPage from './TaskDetailPage.jsx';

const BOARD_STATUSES = Array.from(new Set(STATUSES.map((status) => status.key)));
const DRAWER_STATUSES = Array.from(new Set([...BOARD_STATUSES, 'BLOCKED']));

export default function IssueDrawer({ mode = 'drawer' }) {
  const { selectedIssue, setSelectedIssue, comments, agentActivity, addComment, updateIssue, deleteIssue, members, projectSprints, projects, projectRepositories, session, navigate, showSuccess, showError } = useWorkspace();
  const [draft, setDraft] = useState(selectedIssue);
  const [comment, setComment] = useState('');

  useEffect(() => setDraft(selectedIssue), [selectedIssue]);
  useEffect(() => {
    if (!selectedIssue) return undefined;
    document.title = `${selectedIssue.issue_key} · ${selectedIssue.title} · Taskman`;
    return () => {
      document.title = 'Taskman';
    };
  }, [selectedIssue?.id, selectedIssue?.issue_key, selectedIssue?.title]);

  const sprintOptions = useMemo(() => {
    if (!draft?.project_id) return [];
    return projectSprints.filter((sprint) => sprint.project_id === draft.project_id && sprint.status !== 'COMPLETED');
  }, [draft?.project_id, projectSprints]);

  const projectRepoOptions = useMemo(() => {
    if (!draft?.project_id) return [];
    return projectRepositories.filter((repository) => repository.project_id === draft.project_id && repository.status === 'ACTIVE');
  }, [draft?.project_id, projectRepositories]);

  const selectedRepository = useMemo(
    () => projectRepoOptions.find((repository) => repository.id === draft?.repository_id) || null,
    [draft?.repository_id, projectRepoOptions]
  );

  useEffect(() => {
    if (!draft?.project_id || !projectRepoOptions.length) return;
    if (draft.repository_id && projectRepoOptions.some((repository) => repository.id === draft.repository_id)) return;
    const matchedRepository = projectRepoOptions.find((repository) => repository.repo === draft.github_repo) || projectRepoOptions.find((repository) => repository.is_default) || projectRepoOptions[0];
    if (matchedRepository && (draft.ai_pickable || draft.repository_id || draft.github_repo || projectRepoOptions.length === 1)) {
      setDraft((current) => ({
        ...current,
        repository_id: current.repository_id || matchedRepository.id,
        github_repo: current.github_repo || matchedRepository.repo
      }));
    }
  }, [draft?.github_repo, draft?.project_id, draft?.repository_id, projectRepoOptions]);

  const branchPreview = useMemo(() => {
    if (!draft) return '';
    const projectKey = draft.project_key || projects.find((project) => project.id === draft.project_id)?.key || 'PROJ';
    const slug = (draft.issue_key || draft.title || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    const prefix = selectedRepository?.branch_prefix || 'ai/';
    return draft.github_branch || `${prefix}${projectKey.toLowerCase()}/${slug}`;
  }, [draft, projects, selectedRepository?.branch_prefix]);

  const hasAgentData = Boolean(
    draft?.ai_pickable ||
    draft?.claimed_by_agent ||
    draft?.agent_status ||
    draft?.github_pr_url ||
    draft?.github_pr_status ||
    draft?.agent_summary ||
    draft?.agent_test_notes ||
    draft?.agent_blocker_reason ||
    draft?.status === 'BLOCKED'
  );
  const taskBadges = getTaskStateBadges(draft);
  const workflowStatus = getBoardWorkflowStatus(draft);
  const lastAgentUpdate = agentActivity[0] || null;
  const taskUrl = getTaskUrl(selectedIssue, session.tenant);
  const openFullPage = async () => {
    if (!taskUrl) return;
    navigate(taskUrl);
  };
  const copyTaskLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${taskUrl}`);
      showSuccess('Task link copied');
    } catch {
      showError(new Error('Unable to copy task link'));
    }
  };

  if (mode !== 'page' && (!selectedIssue || !draft)) return null;

  const save = async () => {
    await updateIssue(selectedIssue.id, {
      title: draft.title,
      description: draft.description || '',
      issue_type: draft.issue_type,
      priority: draft.priority,
      status: draft.status,
      project_id: draft.project_id,
      assignee_id: draft.assignee_id || null,
      sprint_id: draft.sprint_id || null,
      story_points: Number(draft.story_points) || 0,
      due_date: draft.due_date || null,
      labels: Array.isArray(draft.labels) ? draft.labels : [],
      ai_pickable: Boolean(draft.ai_pickable),
      github_branch: draft.github_branch || null,
      github_pr_url: draft.github_pr_url || null,
      github_pr_number: draft.github_pr_number ? Number(draft.github_pr_number) : null,
      github_pr_status: draft.github_pr_status || null,
      agent_summary: draft.agent_summary || '',
      agent_test_notes: draft.agent_test_notes || '',
      agent_blocker_reason: draft.agent_blocker_reason || '',
      repository_id: draft.repository_id || null,
      github_repo: selectedRepository?.repo || draft.github_repo || null
    });
  };

  const quickStatus = async (status) => {
    setDraft((current) => ({ ...current, status }));
    await updateIssue(selectedIssue.id, { status });
  };

  const requestChanges = async () => {
    await updateIssue(selectedIssue.id, { status: 'CHANGES_REQUESTED', github_pr_status: 'CHANGES_REQUESTED' });
  };

  const markBlocked = async () => {
    await updateIssue(selectedIssue.id, {
      status: 'BLOCKED',
      agent_blocker_reason: draft.agent_blocker_reason || 'Blocked by review or dependency'
    });
  };

  const releaseClaim = async () => {
    await updateIssue(selectedIssue.id, {
      claimed_by_agent: null,
      agent_status: 'RELEASED',
      claim_expires_at: null
    });
  };

  const moveToReview = async () => {
    await updateIssue(selectedIssue.id, { status: 'IN_REVIEW' });
  };

  const moveToDone = async () => {
    if (draft.github_pr_status !== 'MERGED' && draft.status !== 'DONE') return;
    await updateIssue(selectedIssue.id, { status: 'DONE' });
  };

  const content = (
    <>
      <div className="drawer-head">
        <div>
          {mode !== 'page' ? (
            <button type="button" className="issue-key-big issue-key-link" onClick={openFullPage} aria-label={`Open ${selectedIssue.issue_key} in full page`}>
              {selectedIssue.issue_key}
            </button>
          ) : (
            <span className="issue-key-big">{selectedIssue.issue_key}</span>
          )}
          <h2>{selectedIssue.title}</h2>
          <p className="drawer-summary">
            <span>{selectedIssue.project_key}</span>
            <span>{selectedIssue.sprint_name || 'No sprint'}</span>
            <span>{selectedIssue.priority}</span>
            <span>{selectedIssue.assignee_name || 'Unassigned'}</span>
            {selectedIssue.ai_pickable ? <span>AI-pickable</span> : null}
          </p>
        </div>
        <div className="drawer-head-actions">
          {mode !== 'page' ? <button type="button" className="ghost tiny" onClick={copyTaskLink}>Copy link</button> : null}
          {mode !== 'page' ? <button type="button" className="ghost tiny" onClick={openFullPage}>Open full page</button> : null}
          {mode === 'page' ? <button type="button" className="ghost tiny" onClick={copyTaskLink}>Copy link</button> : null}
          {mode === 'page' ? <button type="button" className="ghost tiny" onClick={() => navigate('/')}>Back to board</button> : null}
          <button className="icon-btn" type="button" onClick={() => (mode === 'page' ? navigate('/') : setSelectedIssue(null))}>×</button>
        </div>
      </div>

        <div className="drawer-quick-actions">
          {BOARD_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={draft.status === status ? 'active' : ''}
              onClick={() => quickStatus(status)}
            >
              {status.replace('_', ' ')}
            </button>
          ))}
        </div>

        <div className="form-stack">
          <label>
            Title
            <input value={draft.title || ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label>
            Description
            <textarea value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <div className="form-grid compact-grid">
            <label>
              Project
              <select value={draft.project_id || ''} onChange={(e) => setDraft({ ...draft, project_id: e.target.value })}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.key} · {project.name}</option>)}
              </select>
            </label>
            <label>
              Status
              <select value={draft.status || 'TODO'} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {DRAWER_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </label>
            <label>
              Priority
              <select value={draft.priority || 'MEDIUM'} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label>
              Type
              <select value={draft.issue_type || 'TASK'} onChange={(e) => setDraft({ ...draft, issue_type: e.target.value })}>
                {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>
              Points
              <input type="number" value={draft.story_points || 0} onChange={(e) => setDraft({ ...draft, story_points: e.target.value })} />
            </label>
            <label>
              Due date
              <input type="date" value={draft.due_date || ''} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} />
            </label>
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={Boolean(draft.ai_pickable)} onChange={(e) => setDraft({ ...draft, ai_pickable: e.target.checked })} />
            <span>
              AI-pickable
              <small>Only safe backend tools can claim this task.</small>
            </span>
          </label>
          <div className="form-grid compact-grid">
            <label>
              Repository
              <select
                value={draft.repository_id || ''}
                onChange={(e) => {
                  const repository = projectRepoOptions.find((item) => item.id === e.target.value) || null;
                  setDraft({ ...draft, repository_id: e.target.value || null, github_repo: repository?.repo || null });
                }}
              >
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
              <input value={draft.github_branch || ''} onChange={(e) => setDraft({ ...draft, github_branch: e.target.value })} placeholder="ai/taskman-123-fix" />
              <small className="field-help">Preview: {branchPreview}</small>
            </label>
          </div>
          <div className="form-grid compact-grid">
            <label>
              PR URL
              <input value={draft.github_pr_url || ''} onChange={(e) => setDraft({ ...draft, github_pr_url: e.target.value })} placeholder="https://github.com/owner/repo/pull/123" />
            </label>
            <label>
              PR number
              <input type="number" min="1" value={draft.github_pr_number || ''} onChange={(e) => setDraft({ ...draft, github_pr_number: e.target.value })} />
            </label>
            <label>
              PR status
              <input value={draft.github_pr_status || ''} onChange={(e) => setDraft({ ...draft, github_pr_status: e.target.value })} placeholder="OPEN, MERGED, CI_FAILED" />
            </label>
          </div>
          <label>
            Agent summary
            <textarea value={draft.agent_summary || ''} onChange={(e) => setDraft({ ...draft, agent_summary: e.target.value })} placeholder="Short final summary from the agent" />
          </label>
          <label>
            Test notes
            <textarea value={draft.agent_test_notes || ''} onChange={(e) => setDraft({ ...draft, agent_test_notes: e.target.value })} placeholder="What was tested, and how" />
          </label>
          <label>
            Blocker reason
            <textarea value={draft.agent_blocker_reason || ''} onChange={(e) => setDraft({ ...draft, agent_blocker_reason: e.target.value })} placeholder="Why this task is blocked" />
          </label>
          <div className="form-grid compact-grid">
            <label>
              Assignee
              <select value={draft.assignee_id || ''} onChange={(e) => setDraft({ ...draft, assignee_id: e.target.value || null })}>
                <option value="">Unassigned</option>
                {members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}
              </select>
            </label>
            <label>
              Sprint
              <select value={draft.sprint_id || ''} onChange={(e) => setDraft({ ...draft, sprint_id: e.target.value || null })}>
                <option value="">No sprint</option>
                {sprintOptions.map((sprint) => <option key={sprint.id} value={sprint.id}>{sprint.name} · {sprint.status}</option>)}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button type="button" className="primary" onClick={save}>Save changes</button>
            <button type="button" className="danger" onClick={() => deleteIssue(selectedIssue.id)}>Delete</button>
          </div>
        </div>

        {hasAgentData && (
          <section className="comments-section agent-section">
            <div className="panel-head wrap">
              <div>
                <h3>Agent / PR</h3>
                <span>Temporary conditions stay as badges while the workflow stays simple.</span>
              </div>
              <div className="drawer-badges">
                <span className={`status-pill ${String(workflowStatus || '').toLowerCase()}`}>{workflowStatus.replace('_', ' ')}</span>
                {taskBadges.map((badge) => <span key={badge.label} className={`issue-badge task-badge ${badge.tone}`}>{badge.label}</span>)}
              </div>
            </div>

            <div className="issue-summary-grid agent-summary-grid">
              <div>
                <span>Agent</span>
                <strong>{draft.claimed_by_agent || draft.agent_status || 'Not claimed'}</strong>
              </div>
              <div>
                <span>Claim expires</span>
                <strong>{draft.claim_expires_at ? formatDate(draft.claim_expires_at) : 'Not set'}</strong>
              </div>
              <div>
                <span>GitHub repo</span>
                <strong>{draft.github_repo || selectedRepository?.repo || 'Not set'}</strong>
              </div>
              <div>
                <span>Branch</span>
                <strong>{branchPreview}</strong>
              </div>
              <div>
                <span>PR link</span>
                <strong>{draft.github_pr_url ? <a href={draft.github_pr_url} target="_blank" rel="noopener noreferrer">Open PR</a> : 'Not linked'}</strong>
              </div>
              <div>
                <span>PR status</span>
                <strong>{draft.github_pr_status || 'Unknown'}</strong>
              </div>
              <div>
                <span>Review status</span>
                <strong>{draft.status === 'CHANGES_REQUESTED' ? 'Changes requested' : workflowStatus.replace('_', ' ')}</strong>
              </div>
              <div>
                <span>CI status</span>
                <strong>{String(draft.github_pr_status || '').toUpperCase() === 'CI_FAILED' ? 'Checks failed' : String(draft.github_pr_status || '').toUpperCase() === 'CI_PASSED' ? 'Checks passed' : 'Unknown'}</strong>
              </div>
              <div className="wide">
                <span>Last agent update</span>
                <strong>{lastAgentUpdate ? `${lastAgentUpdate.actor_name || lastAgentUpdate.actor_kind || 'Agent'} · ${lastAgentUpdate.message}` : 'No agent activity yet.'}</strong>
              </div>
              {(draft.status === 'BLOCKED' || draft.agent_blocker_reason) && (
                <div className="wide">
                  <span>Blocker reason</span>
                  <strong>{draft.agent_blocker_reason || 'Blocked'}</strong>
                </div>
              )}
              {draft.status === 'CHANGES_REQUESTED' && (
                <div className="wide">
                  <span>Changes requested reason</span>
                  <strong>{draft.github_pr_status || 'Requested during review'}</strong>
                </div>
              )}
            </div>

            <div className="agent-pr-actions">
              {draft.github_pr_url && <button type="button" className="ghost" onClick={() => window.open(draft.github_pr_url, '_blank', 'noopener,noreferrer')}>Open PR</button>}
              {draft.github_pr_url && <button type="button" className="ghost" onClick={requestChanges}>Request changes</button>}
              <button type="button" className="ghost" onClick={markBlocked}>Mark blocked</button>
              <button type="button" className="ghost" onClick={releaseClaim}>Release agent claim</button>
              <button type="button" className="ghost" onClick={moveToReview}>Move to Review</button>
              {(draft.github_pr_status === 'MERGED' || draft.status === 'DONE') && (
                <button type="button" className="primary" onClick={moveToDone}>Move to Done</button>
              )}
            </div>

            <div className="comment-list">
              {agentActivity.map((item) => (
                <div className="comment" key={item.id}>
                  <strong>{item.actor_name || item.actor_kind || 'Agent'}</strong>
                  <p>{item.message}</p>
                  <small>{formatDate(item.created_at)}</small>
                </div>
              ))}
              {!agentActivity.length && <p className="muted">No agent activity yet.</p>}
            </div>
          </section>
        )}

        {!hasAgentData && (
          <section className="comments-section agent-section">
            <h3>Agent activity</h3>
            <div className="comment-list">
              {agentActivity.map((item) => (
                <div className="comment" key={item.id}>
                  <strong>{item.actor_name || item.actor_kind || 'Agent'}</strong>
                  <p>{item.message}</p>
                  <small>{formatDate(item.created_at)}</small>
                </div>
              ))}
              {!agentActivity.length && <p className="muted">No agent activity yet.</p>}
            </div>
          </section>
        )}

        <section className="comments-section">
          <h3>Comments</h3>
          <div className="comment-list">
            {comments.map((item) => <div className="comment" key={item.id}><strong>{item.author_name || 'User'}</strong><p>{item.body}</p><small>{formatDate(item.created_at)}</small></div>)}
            {!comments.length && <p className="muted">No comments yet.</p>}
          </div>
          <form onSubmit={async (event) => { event.preventDefault(); if (comment.trim()) { await addComment(selectedIssue.id, comment); setComment(''); } }}>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a useful update for the team" />
            <button className="primary">Add comment</button>
          </form>
        </section>
      </>
  );

  if (mode === 'page') return <TaskDetailPage />;

  return (
    <div className="drawer-backdrop" onMouseDown={() => setSelectedIssue(null)}>
      <aside className="issue-drawer" onMouseDown={(event) => event.stopPropagation()}>
        {content}
      </aside>
    </div>
  );
}
