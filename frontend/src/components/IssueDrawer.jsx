import { useEffect, useMemo, useState } from 'react';
import { ISSUE_TYPES, PRIORITIES, STATUSES } from '../constants.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { formatDate } from '../utils.js';

const BOARD_STATUSES = STATUSES.map((status) => status.key);
const DRAWER_STATUSES = [...BOARD_STATUSES, 'BLOCKED'];

export default function IssueDrawer() {
  const { selectedIssue, setSelectedIssue, comments, addComment, updateIssue, deleteIssue, members, projectSprints, projects } = useWorkspace();
  const [draft, setDraft] = useState(selectedIssue);
  const [comment, setComment] = useState('');

  useEffect(() => setDraft(selectedIssue), [selectedIssue]);

  const sprintOptions = useMemo(() => {
    if (!draft?.project_id) return [];
    return projectSprints.filter((sprint) => sprint.project_id === draft.project_id && sprint.status !== 'COMPLETED');
  }, [draft?.project_id, projectSprints]);

  if (!selectedIssue || !draft) return null;

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
      labels: Array.isArray(draft.labels) ? draft.labels : []
    });
  };

  const quickStatus = async (status) => {
    setDraft((current) => ({ ...current, status }));
    await updateIssue(selectedIssue.id, { status });
  };

  return (
    <div className="drawer-backdrop" onMouseDown={() => setSelectedIssue(null)}>
      <aside className="issue-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <span className="issue-key-big">{selectedIssue.issue_key}</span>
            <h2>{selectedIssue.title}</h2>
            <p className="drawer-summary">
              <span>{selectedIssue.project_key}</span>
              <span>{selectedIssue.sprint_name || 'No sprint'}</span>
              <span>{selectedIssue.priority}</span>
              <span>{selectedIssue.assignee_name || 'Unassigned'}</span>
            </p>
          </div>
          <button className="icon-btn" onClick={() => setSelectedIssue(null)}>×</button>
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
      </aside>
    </div>
  );
}
