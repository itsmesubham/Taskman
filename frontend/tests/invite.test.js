import test from 'node:test';
import assert from 'node:assert/strict';
import { extractInviteCode } from '../src/utils/invite.js';

test('extractInviteCode reads codes from invite and join URLs', () => {
  assert.equal(extractInviteCode('https://taskman.fnetrix.com/invite/grabbit-x7k92a'), 'grabbit-x7k92a');
  assert.equal(extractInviteCode('https://taskman.fnetrix.com/join/grabbit-x7k92a?utm=1'), 'grabbit-x7k92a');
});

test('extractInviteCode accepts bare paths and plain invite codes', () => {
  assert.equal(extractInviteCode('/invite/grabbit-x7k92a'), 'grabbit-x7k92a');
  assert.equal(extractInviteCode('join/grabbit-x7k92a'), 'grabbit-x7k92a');
  assert.equal(extractInviteCode('grabbit-x7k92a'), 'grabbit-x7k92a');
});

test('extractInviteCode trims and falls back cleanly for non invite values', () => {
  assert.equal(extractInviteCode('   '), '');
  assert.equal(extractInviteCode('/not-an-invite'), 'not-an-invite');
});

test('extractInviteCode decodes encoded invite codes from urls and paths', () => {
  assert.equal(extractInviteCode('https://taskman.fnetrix.com/invite/grabbit%2Dalpha'), 'grabbit-alpha');
  assert.equal(extractInviteCode('/join/grabbit%2Dalpha'), 'grabbit-alpha');
});
