export function normalizeMemberships(memberships) {
  return Array.isArray(memberships) ? memberships.filter(Boolean) : [];
}

export function pickPreferredMembership(memberships, preferredTenantId = null) {
  const normalized = normalizeMemberships(memberships);
  if (!normalized.length) return null;
  if (preferredTenantId) {
    const preferred = normalized.find((membership) => membership.tenant_id === preferredTenantId);
    if (preferred) return preferred;
  }
  return normalized[0];
}

export function buildActiveWorkspaceContext({ user = null, memberships = [], preferredTenantId = null } = {}) {
  const normalized = normalizeMemberships(memberships);
  const preferred = pickPreferredMembership(normalized, preferredTenantId);
  if (!preferred) {
    return {
      user: user || null,
      tenant: null,
      memberships: normalized,
      activeMembership: null
    };
  }

  return {
    user: {
      ...(user || {}),
      role: user?.role || preferred.role || null,
      active_tenant_id: preferred.tenant_id
    },
    tenant: {
      id: preferred.tenant_id,
      name: preferred.tenant_name || 'Workspace',
      slug: preferred.tenant_slug || ''
    },
    memberships: normalized,
    activeMembership: preferred
  };
}

export function buildAuthSessionFromResult(result, apiBase) {
  const memberships = normalizeMemberships(result?.memberships);
  const preferredTenantId = result?.user?.active_tenant_id || memberships[0]?.tenant_id || null;
  const workspace = buildActiveWorkspaceContext({
    user: result?.user || null,
    memberships,
    preferredTenantId
  });

  return {
    apiBase,
    token: result?.access_token || null,
    user: workspace.user,
    tenant: workspace.tenant,
    memberships
  };
}

export function buildInviteAcceptedSession(baseSession, inviteResult) {
  const memberships = normalizeMemberships(inviteResult?.memberships?.length ? inviteResult.memberships : baseSession?.memberships);
  const inviteTenant = inviteResult?.tenant
    ? {
        id: inviteResult.tenant.id,
        name: inviteResult.tenant.name,
        slug: inviteResult.tenant.slug || ''
      }
    : baseSession?.tenant || null;

  return {
    ...(baseSession || {}),
    token: inviteResult?.access_token || baseSession?.token || null,
    user: {
      ...((baseSession && baseSession.user) || {}),
      role: inviteResult?.membership?.role || baseSession?.user?.role || 'MEMBER',
      active_tenant_id: inviteResult?.active_tenant_id || inviteTenant?.id || baseSession?.user?.active_tenant_id || null
    },
    tenant: inviteTenant,
    memberships
  };
}

export function resolveCurrentWorkspaceRole({ user = null, memberships = [], activeTenantId = null } = {}) {
  const active = pickPreferredMembership(memberships, activeTenantId || user?.active_tenant_id || null);
  return String(user?.role || active?.role || '').toUpperCase() || null;
}
