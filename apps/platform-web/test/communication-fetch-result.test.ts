import assert from 'node:assert/strict';
import test from 'node:test';
import { communicationFetchResult, requireCommunicationResponse } from '../lib/communication-fetch-result.ts';

test('preserves status, headers and unread body for successful and ordinary denied responses', async () => {
  for (const status of [200, 201, 400, 401, 403, 409, 500]) {
    const response = Response.json({ status }, { status, headers: { 'x-test': 'preserved' } });
    const restored = requireCommunicationResponse(await communicationFetchResult(response));
    assert.equal(restored, response);
    assert.equal(restored.status, status);
    assert.equal(restored.headers.get('x-test'), 'preserved');
    assert.equal(restored.bodyUsed, false);
    assert.deepEqual(await restored.json(), { status });
  }
});

test('exposes only a real 403 reverification challenge to Clerk', async () => {
  const body = { clerk_error: { type: 'forbidden', reason: 'reverification-error', metadata: { reverification: { level: 'multi_factor', afterMinutes: 5 } } } };
  assert.deepEqual(await communicationFetchResult(Response.json(body, { status: 403 })), body);
  const success = Response.json(body, { status: 200 });
  assert.equal(requireCommunicationResponse(await communicationFetchResult(success)), success);
  const nonJson = new Response('Forbidden', { status: 403 });
  assert.equal(await requireCommunicationResponse(await communicationFetchResult(nonJson)).text(), 'Forbidden');
});

test('cancelled or still-required verification cannot be mistaken for success', () => {
  for (const result of [null, undefined, { clerk_error: { type: 'forbidden', reason: 'reverification-error' } }] as const) {
    assert.throws(() => requireCommunicationResponse(result), /request was not completed/);
  }
});
