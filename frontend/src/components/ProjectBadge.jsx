export default function ProjectBadge({ projectKey }) {
  if (!projectKey) return null;
  return <span className="project-badge">{projectKey}</span>;
}
