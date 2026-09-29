import assert from 'node:assert/strict';
import test from 'node:test';
import { PushoverProvider } from '../src/pushover.js';

test('Pushover sends an alarm with the required credentials and priority', async () => {
  const originalFetch = globalThis.fetch;
  let destination = '';
  let body: URLSearchParams | null = null;
  globalThis.fetch = async (input, init) => {
    destination = String(input);
    body = init?.body as URLSearchParams;
    return new Response(JSON.stringify({ status: 1 }), { status: 200 });
  };
  try {
    await new PushoverProvider('app-token', 'user-key').send({
      id: 'controller-alarm', title: 'System alarm', message: 'Check the panel', severity: 'error',
      firstSeenAt: new Date().toISOString(), notifiedAt: null, value: 1,
    });
    assert.equal(destination, 'https://api.pushover.net/1/messages.json');
    assert.equal(body!.get('token'), 'app-token');
    assert.equal(body!.get('user'), 'user-key');
    assert.equal(body!.get('priority'), '1');
    assert.equal(body!.get('message'), 'Check the panel');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Pushover API failure does not expose keys in error text', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('rejected', { status: 400 });
  try {
    await assert.rejects(
      new PushoverProvider('secret-app-token', 'secret-user-key').send({
        id: 'test', title: 'Test', message: 'Test', severity: 'warning',
        firstSeenAt: new Date().toISOString(), notifiedAt: null, value: 1,
      }),
      error => error instanceof Error && error.message === 'Pushover rejected notification (HTTP 400)',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
