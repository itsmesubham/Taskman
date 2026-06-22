import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActiveWorkspaceContext, buildAuthSessionFromResult, buildInviteAcceptedSession, normalizeMemberships, pickPreferredMembership } from '../src/utils/workspaceSession.js';

test('normalizeMemberships removes falsey values', () => {
  assert.deepEqual(normalizeMemberships([null, { tenant_id: 't1' }, undefined]), [{ tenant_id: 't1' }]);
});

test('pickPreferredMembership respects preferred tenant when present', () => {
  const memberships = [
    { tenant_id: 't1', role: 'MEMBER', tenant_name: 'One', tenant_slug: 'one' },
    { tenant_id: 't2', role: 'OWNER', tenant_name: 'Two', tenant_slug: 'two' }
  ];
  assert.equal(pickPreferredMembership(memberships, 't2').tenant_id, 't2');
  assert.equal(pickPreferredMembership(memberships, 'missing').tenant_id, 't1');
});

test('buildActiveWorkspaceContext returns the selected tenant and enriched user', () => {
  const result = buildActiveWorkspaceContext({
    user: { id: 'user-1', name: 'Ada' },
    memberships: [
      { tenant_id: 't1', role: 'MEMBER', tenant_name: 'One', tenant_slug: 'one' },
      { tenant_id: 't2', role: 'OWNER', tenant_name: 'Two', tenant_slug: 'two' }
    ],
    preferredTenantId: 't2'
  });
  assert.equal(result.tenant.id, 't2');
  assert.equal(result.user.role, 'OWNER');
  assert.equal(result.user.active_tenant_id, 't2');
});

test('buildActiveWorkspaceContext returns empty workspace state when memberships are missing', () => {
  const result = buildActiveWorkspaceContext({ user: { id: 'user-1' }, memberships: null });
  assert.equal(result.tenant, null);
  assert.equal(result.activeMembership, null);
  assert.deepEqual(result.memberships, []);
});

test('buildAuthSessionFromResult creates a ready session from auth payload', () => {
  const session = buildAuthSessionFromResult(
    {
      access_token: 'token-1',
      user: { id: 'user-1', name: 'Ada', active_tenant_id: 't2' },
      memberships: [
        { tenant_id: 't1', role: 'MEMBER', tenant_name: 'One', tenant_slug: 'one' },
        { tenant_id: 't2', role: 'OWNER', tenant_name: 'Two', tenant_slug: 'two' }
      ]
    },
    'https://api.example.com'
  );
  assert.equal(session.token, 'token-1');
  assert.equal(session.tenant.id, 't2');
  assert.equal(session.user.role, 'OWNER');
  assert.equal(session.user.active_tenant_id, 't2');
});

test('buildInviteAcceptedSession switches active tenant and keeps invite memberships', () => {
  const session = buildInviteAcceptedSession(
    {
      token: 'token-1',
      user: { id: 'user-1', role: 'OWNER', active_tenant_id: 'old-tenant' },
      tenant: { id: 'old-tenant', name: 'Old', slug: 'old' },
      memberships: [{ tenant_id: 'old-tenant', role: 'OWNER', tenant_name: 'Old', tenant_slug: 'old' }]
    },
    {
      access_token: 'token-2',
      active_tenant_id: 'new-tenant',
      tenant: { id: 'new-tenant', name: 'New', slug: 'new' },
      membership: { role: 'MEMBER' },
      memberships: [{ tenant_id: 'new-tenant', role: 'MEMBER', tenant_name: 'New', tenant_slug: 'new' }]
    }
  );
  assert.equal(session.token, 'token-2');
  assert.equal(session.tenant.id, 'new-tenant');
  assert.equal(session.user.role, 'MEMBER');
  assert.equal(session.user.active_tenant_id, 'new-tenant');
  assert.equal(session.memberships[0].tenant_id, 'new-tenant');
});
