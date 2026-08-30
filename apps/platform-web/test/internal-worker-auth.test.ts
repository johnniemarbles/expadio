import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InternalWorkerAuthError,
  authenticateInternalWorkerRequest,
} from '../lib/internal-worker-auth';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function request(token: string | null, tenantId = TENANT): Request {
  const headers = new Headers();
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  headers.set('x-expadio-tenant-id', tenantId);
  return new Request('http://localhost/api/internal/domain-events/run', {
    method: 'POST',
    headers,
  });
}

test('internal worker is disabled when no machine token is configured', () => {
  const previous = process.env.EXPADIO_INTERNAL_WORKER_TOKEN;
  delete process.env.EXPADIO_INTERNAL_WORKER_TOKEN;
  try {
    assert.throws(
      () => authenticateInternalWorkerRequest(request('secret')),
      (error) =>
        error instanceof InternalWorkerAuthError
        && error.status === 503
        && error.reasonCode === 'INTERNAL_WORKER_DISABLED',
    );
  } finally {
    if (previous === undefined) delete process.env.EXPADIO_INTERNAL_WORKER_TOKEN;
    else process.env.EXPADIO_INTERNAL_WORKER_TOKEN = previous;
  }
});

test('internal worker requires the exact bearer token', () => {
  const previous = process.env.EXPADIO_INTERNAL_WORKER_TOKEN;
  process.env.EXPADIO_INTERNAL_WORKER_TOKEN = 'worker-secret';
  try {
    assert.throws(
      () => authenticateInternalWorkerRequest(request('wrong-secret')),
      (error) =>
        error instanceof InternalWorkerAuthError
        && error.status === 401
        && error.reasonCode === 'INTERNAL_WORKER_UNAUTHORIZED',
    );

    assert.deepEqual(
      authenticateInternalWorkerRequest(request('worker-secret')),
      { tenantId: TENANT },
    );
  } finally {
    if (previous === undefined) delete process.env.EXPADIO_INTERNAL_WORKER_TOKEN;
    else process.env.EXPADIO_INTERNAL_WORKER_TOKEN = previous;
  }
});

test('internal worker rejects a missing or malformed tenant UUID', () => {
  const previous = process.env.EXPADIO_INTERNAL_WORKER_TOKEN;
  process.env.EXPADIO_INTERNAL_WORKER_TOKEN = 'worker-secret';
  try {
    assert.throws(
      () => authenticateInternalWorkerRequest(request('worker-secret', 'not-a-tenant')),
      (error) =>
        error instanceof InternalWorkerAuthError
        && error.status === 400
        && error.reasonCode === 'INTERNAL_WORKER_TENANT_REQUIRED',
    );
  } finally {
    if (previous === undefined) delete process.env.EXPADIO_INTERNAL_WORKER_TOKEN;
    else process.env.EXPADIO_INTERNAL_WORKER_TOKEN = previous;
  }
});
