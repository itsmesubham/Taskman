const REVIEW_PR_STATUSES = new Set(['OPEN', 'APPROVED', 'CHANGES_REQUESTED', 'CI_FAILED']);

export function getBoardWorkflowStatus(issue) {
  const status = String(issue?.status || 'TODO');
  const githubStatus = String(issue?.github_pr_status || '').toUpperCase();

  if (status === 'DONE' || githubStatus === 'MERGED') return 'DONE';
  if (status === 'IN_REVIEW' || status === 'CHANGES_REQUESTED') return 'IN_REVIEW';
  if (githubStatus && REVIEW_PR_STATUSES.has(githubStatus)) return 'IN_REVIEW';
  if (status === 'BLOCKED') {
    return issue?.github_pr_url ? 'IN_REVIEW' : 'IN_PROGRESS';
  }
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (issue?.agent_status === 'CLAIMED' || issue?.agent_status === 'WORKING') return 'IN_PROGRESS';
  return 'TODO';
}

export function getTaskStateBadges(issue) {
  const badges = [];
  const githubStatus = String(issue?.github_pr_status || '').toUpperCase();

  if (issue?.ai_pickable) badges.push({ label: 'AI pickable', tone: 'ai-pickable' });
  if (issue?.claimed_by_agent) badges.push({ label: `Claimed by ${issue.claimed_by_agent}`, tone: 'claimed' });
  if (issue?.agent_status === 'CLAIMED' || issue?.agent_status === 'WORKING') {
    badges.push({ label: 'AI working', tone: 'ai-working' });
  }
  if (issue?.github_pr_url) badges.push({ label: 'PR ↗', tone: 'pr-link' });
  if (githubStatus === 'OPEN') badges.push({ label: 'PR open', tone: 'pr-open' });
  if (githubStatus === 'APPROVED') badges.push({ label: 'Review approved', tone: 'needs-review' });
  if (githubStatus === 'CHANGES_REQUESTED' || issue?.status === 'CHANGES_REQUESTED') {
    badges.push({ label: 'Changes requested', tone: 'changes-requested' });
  }
  if (githubStatus === 'CI_FAILED') badges.push({ label: 'CI failed', tone: 'ci-failed' });
  if (githubStatus === 'CI_PASSED') badges.push({ label: 'Checks passed', tone: 'review-approved' });
  if (githubStatus === 'MERGED' || (issue?.status === 'DONE' && issue?.github_pr_url)) badges.push({ label: 'PR merged', tone: 'pr-merged' });
  if (issue?.status === 'BLOCKED') badges.push({ label: 'Blocked', tone: 'blocked' });
  if (issue?.github_pr_url && githubStatus !== 'MERGED' && githubStatus !== 'OPEN' && githubStatus !== 'APPROVED' && githubStatus !== 'CHANGES_REQUESTED' && githubStatus !== 'CI_FAILED' && githubStatus !== 'CI_PASSED') {
    badges.push({ label: 'Needs review', tone: 'needs-review' });
  } else if (!githubStatus && issue?.github_pr_url) {
    badges.push({ label: 'Needs review', tone: 'needs-review' });
  }

  return badges;
}
