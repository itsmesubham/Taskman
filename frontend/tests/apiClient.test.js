import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, isSecureApiBase, normalizeApiBase } from '../src/api/client.js';

test('normalizeApiBase strips trailing slashes and falls back to the default base', () => {
  assert.equal(normalizeApiBase('https://api.example.com/'), 'https://api.example.com');
  assert.equal(normalizeApiBase('  https://api.example.com/v1//  '), 'https://api.example.com/v1');
});

test('isSecureApiBase accepts production HTTPS and localhost development URLs', () => {
  assert.equal(isSecureApiBase('https://api.example.com'), true);
  assert.equal(isSecureApiBase('http://localhost:8080'), true);
  assert.equal(isSecureApiBase('http://127.0.0.1:3000'), true);
  assert.equal(isSecureApiBase('http://api.example.com'), false);
});

test('ApiClient.request sends auth headers and serializes json bodies', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  try {
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return {
        status: 200,
        ok: true,
        json: async () => ({ ok: true })
      };
    };

    const client = new ApiClient(() => ({ token: 'token-1', apiBase: 'https://api.example.com/' }));
    const data = await client.post('/issues', { title: 'Fix forms' });
    assert.deepEqual(data, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.example.com/issues');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token-1');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.equal(calls[0].options.body, JSON.stringify({ title: 'Fix forms' }));
  } finally {
    global.fetch = originalFetch;
  }
});

test('ApiClient.request calls unauthorized handler and surfaces server errors', async () => {
  const originalFetch = global.fetch;
  let unauthorizedCalls = 0;
  const client = new ApiClient(() => ({ token: 'token-2', apiBase: 'https://api.example.com' }), () => {
    unauthorizedCalls += 1;
  });

  try {
    global.fetch = async () => ({
      status: 401,
      ok: false,
      json: async () => ({ detail: 'Expired' })
    });

    await assert.rejects(() => client.get('/me'), /Expired/);
    assert.equal(unauthorizedCalls, 1);

    global.fetch = async () => ({
      status: 500,
      ok: false,
      json: async () => ({ message: 'Boom' })
    });

    await assert.rejects(() => client.get('/me'), /Boom/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('ApiClient.request tolerates empty 204 responses', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({
      status: 204,
      ok: true,
      json: async () => { throw new Error('No body'); }
    });

    const client = new ApiClient(() => ({ token: null, apiBase: 'https://api.example.com' }));
    const data = await client.delete('/issues/issue-1');
    assert.deepEqual(data, {});
  } finally {
    global.fetch = originalFetch;
  }
});
