import { priorityClass } from '../utils.js';

export default function PriorityBadge({ priority }) {
  return <span className={priorityClass(priority)}>{priority || 'MEDIUM'}</span>;
}
