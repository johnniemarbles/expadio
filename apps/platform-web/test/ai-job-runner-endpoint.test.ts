import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '../app/api/internal/ai-jobs/run/route.ts';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function request(body: unknown, token = 'worker-secret'): Request {
  return new Request('http://localhost/api/internal/ai-jobs/run', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-expadio-tenant-id': TENANT,
    },
    body: JSON.stringify(body),
  });
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('AI worker endpoint rejects unauthorized machine callers before database access', async () => {
  const token = process.env.EXPADIO_INTERNAL_WORKER_TOKEN;
  const subject = process.env.EXPADIO_AI_WORKER_SUBJECT_ID;
  process.env.EXPADIO_INTERNAL_WORKER_TOKEN = 'worker-secret';
  process.env.EXPADIO_AI_WORKER_SUBJECT_ID = 'ai-worker';
  try {
    const response = await POST(request({}, 'wrong-secret'));
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.reasonCode, 'INTERNAL_WORKER_UNAUTHORIZED');
  } finally {
    restore('EXPADIO_INTERNAL_WORKER_TOKEN', token);
    restore('EXPADIO_AI_WORKER_SUBJECT_ID', subject);
  }
});

test('AI worker endpoint is disabled without a configured service identity', async () => {
  const token = process.env.EXPADIO_INTERNAL_WORKER_TOKEN;
  const subject = process.env.EXPADIO_AI_WORKER_SUBJECT_ID;
  process.env.EXPADIO_INTERNAL_WORKER_TOKEN = 'worker-secret';
  delete process.env.EXPADIO_AI_WORKER_SUBJECT_ID;
  try {
    const response = await POST(request({}));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.reasonCode, 'AI_WORKER_IDENTITY_DISABLED');
  } finally {
    restore('EXPADIO_INTERNAL_WORKER_TOKEN', token);
    restore('EXPADIO_AI_WORKER_SUBJECT_ID', subject);
  }
});

test('AI worker endpoint rejects unbounded or malformed batch limits before database access', async () => {
  const token = process.env.EXPADIO_INTERNAL_WORKER_TOKEN;
  const subject = process.env.EXPADIO_AI_WORKER_SUBJECT_ID;
  process.env.EXPADIO_INTERNAL_WORKER_TOKEN = 'worker-secret';
  process.env.EXPADIO_AI_WORKER_SUBJECT_ID = 'ai-worker';
  try {
    for (const limit of [0, -1, 1.5, '5']) {
      const response = await POST(request({ limit }));
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.reasonCode, 'INTERNAL_WORKER_LIMIT_INVALID');
    }
  } finally {
    restore('EXPADIO_INTERNAL_WORKER_TOKEN', token);
    restore('EXPADIO_AI_WORKER_SUBJECT_ID', subject);
  }
});
