import { useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { cx } from '../utils.js';

const VISIBILITY_LABELS = {
  EVERYONE: 'Everyone',
  SOME_USERS: 'Some users',
  PRIVATE: 'Private'
};

export default function ProjectsPage() {
  const { session, projects, createProject, updateProject, activeProjectId, setActiveProjectId, sprintSchedule } = useWorkspace();
  const [formOpen, setFormOpen] = useState(projects.length === 0);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('EVERYONE');
  const isAdmin = String(session.user?.role || '').toUpperCase() === 'ADMIN';

  const submit = async (event) => {
    event.preventDefault();
    await createProject({ name, key, description, visibility });
    setName('');
    setKey('');
    setDescription('');
    setVisibility('EVERYONE');
    setFormOpen(false);
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Workspace setup"
        title="Projects"
        description="Projects stay available for organization and reporting, but they are no longer the first thing users must think about."
        action={(
          <button type="button" className="primary" onClick={() => setFormOpen((current) => !current)}>
            {formOpen ? 'Close' : 'New project'}
          </button>
        )}
      />

      {formOpen && (
        <section className="panel form-panel">
          <form className="form-grid" onSubmit={submit}>
            <label>
              Project name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer App" required />
            </label>
            <label>
              Key
              <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="CAPP" />
            </label>
            <label>
              Visibility
              <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="wide">
              Description
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this project owns" />
            </label>
            <div className="form-actions wide">
              <button type="submit" className="primary">Create project</button>
            </div>
          </form>
        </section>
      )}

      <div className="project-grid">
        {projects.map((project) => {
          const isDefault = sprintSchedule?.defaultProject?.id === project.id || (!sprintSchedule?.defaultProject && projects[0]?.id === project.id);
          return (
            <article
              key={project.id}
              className={cx('project-card', activeProjectId === project.id && 'active')}
              onClick={() => setActiveProjectId(project.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setActiveProjectId(project.id);
                }
              }}
            >
              <div className="project-card-head">
                <span className="project-key">{project.key}</span>
                <div className="project-card-badges">
                  {isDefault && <span className="default-badge">Default</span>}
                  <span className="visibility-badge">{VISIBILITY_LABELS[project.visibility] || 'Everyone'}</span>
                </div>
              </div>
              <h3>{project.name}</h3>
              <p>{project.description || 'No description'}</p>
              <div className="project-card-foot">
                <small>{project.status}</small>
                {(isAdmin || project.created_by === session.user?.id) && (
                  <select
                    value={project.visibility || 'EVERYONE'}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => updateProject(project.id, { visibility: event.target.value })}
                  >
                    {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
