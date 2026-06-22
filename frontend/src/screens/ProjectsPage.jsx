import { useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { cx } from '../utils.js';

export default function ProjectsPage() {
  const { projects, createProject, activeProjectId, setActiveProjectId } = useWorkspace();
  const [formOpen, setFormOpen] = useState(projects.length === 0);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    await createProject({ name, key, description });
    setName('');
    setKey('');
    setDescription('');
    setFormOpen(false);
  };

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Workspace setup" title="Projects" description="Create business projects and switch between them from the top bar." action={<button className="primary" onClick={() => setFormOpen(!formOpen)}>{formOpen ? 'Close' : 'New project'}</button>} />

      {formOpen && <section className="panel form-panel"><form className="form-grid" onSubmit={submit}>
        <label>Project name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer App" required /></label>
        <label>Key<input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="CAPP" /></label>
        <label className="wide">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this project owns" /></label>
        <div className="form-actions wide"><button className="primary">Create project</button></div>
      </form></section>}

      <div className="project-grid">
        {projects.map((project) => <button key={project.id} className={cx('project-card', activeProjectId === project.id && 'active')} onClick={() => setActiveProjectId(project.id)}>
          <span className="project-key">{project.key}</span><h3>{project.name}</h3><p>{project.description || 'No description'}</p><small>{project.status}</small>
        </button>)}
      </div>
    </div>
  );
}
