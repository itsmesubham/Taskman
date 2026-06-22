import { useEffect, useState } from 'react';
import { ISSUE_STATUSES, ISSUE_TYPES, PRIORITIES } from '../constants.js';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { formatDate } from '../utils.js';

export default function IssueDrawer() {
  const { selectedIssue, setSelectedIssue, comments, addComment, updateIssue, deleteIssue } = useWorkspace();
  const [draft, setDraft] = useState(selectedIssue);
  const [comment, setComment] = useState('');

  useEffect(() => setDraft(selectedIssue), [selectedIssue]);
  if (!selectedIssue || !draft) return null;

  const save = async () => {
    await updateIssue(selectedIssue.id, {
      title: draft.title,
      description: draft.description || '',
      issue_type: draft.issue_type,
      priority: draft.priority,
      status: draft.status,
      story_points: Number(draft.story_points) || 0,
      due_date: draft.due_date || null,
      labels: Array.isArray(draft.labels) ? draft.labels : []
    });
  };

  return (
    <div className="drawer-backdrop" onMouseDown={() => setSelectedIssue(null)}>
      <aside className="issue-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <div><span className="issue-key-big">{selectedIssue.issue_key}</span><h2>{selectedIssue.title}</h2></div>
          <button className="icon-btn" onClick={() => setSelectedIssue(null)}>×</button>
        </div>

        <div className="form-stack">
          <label>Title<input value={draft.title || ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>Description<textarea value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
          <div className="form-grid compact-grid">
            <label>Status<select value={draft.status || 'TODO'} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>{ISSUE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>Priority<select value={draft.priority || 'MEDIUM'} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></label>
            <label>Type<select value={draft.issue_type || 'TASK'} onChange={(e) => setDraft({ ...draft, issue_type: e.target.value })}>{ISSUE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label>Points<input type="number" value={draft.story_points || 0} onChange={(e) => setDraft({ ...draft, story_points: e.target.value })} /></label>
            <label>Due date<input type="date" value={draft.due_date || ''} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} /></label>
          </div>
          <div className="form-actions"><button className="primary" onClick={save}>Save changes</button><button className="danger" onClick={() => deleteIssue(selectedIssue.id)}>Delete</button></div>
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
