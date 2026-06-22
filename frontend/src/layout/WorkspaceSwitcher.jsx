import { useWorkspace } from '../context/WorkspaceContext.jsx';

export default function WorkspaceSwitcher() {
  const { activeProjectId, setActiveProjectId, projects, activeProject, session } = useWorkspace();

  return (
    <div className="workspace-switcher">
      <div className="brand-mark small">T</div>
      <div className="workspace-switcher-copy">
        <strong>Taskman</strong>
        <span>{session.tenant?.name || 'Workspace'}</span>
      </div>
      <select value={activeProjectId} onChange={(event) => setActiveProjectId(event.target.value)}>
        <option value="">{activeProject?.name || 'All projects'}</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.key} · {project.name}
          </option>
        ))}
      </select>
    </div>
  );
}
