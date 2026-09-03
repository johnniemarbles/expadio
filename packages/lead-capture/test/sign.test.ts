import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import test from 'node:test';
import { captureSigningBytes, serializeSubmission } from '../src/contract.ts';
import { normalizeSubmission } from '../src/normalize.ts';
import { createServerCaptureClient, signCaptureBody } from '../src/sign.ts';

function keypairPem() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey,
    privateKeyPkcs8Pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

test('SDK signatures verify with node:crypto exactly as the live ingress does', async () => {
  const { publicKey, privateKeyPkcs8Pem } = keypairPem();
  const body = serializeSubmission(normalizeSubmission({ contact: { email: 'lead@example.com' } }));
  const timestampSeconds = 1788372000;

  const headers = await signCaptureBody({ privateKeyPkcs8Pem, body, idempotencyKey: 'idmp-1', timestampSeconds });

  const signature = Buffer.from(headers['x-expadio-capture-signature'], 'base64');
  assert.equal(signature.length, 64);
  assert.equal(headers['x-expadio-capture-timestamp'], '1788372000');
  assert.equal(headers['x-expadio-idempotency-key'], 'idmp-1');

  // The ingress verifies over `${timestamp}.${rawBody}` — prove that byte string.
  const covered = Buffer.from(captureSigningBytes('1788372000', body));
  assert.equal(verify(null, covered, publicKey, signature), true);

  // Tampering with the body invalidates the signature.
  const tampered = serializeSubmission(normalizeSubmission({ contact: { email: 'attacker@example.com' } }));
  assert.equal(verify(null, Buffer.from(captureSigningBytes('1788372000', tampered)), publicKey, signature), false);
});

test('server client signs, targets the source-bound ingress URL, and sends the signed body', async () => {
  const { publicKey, privateKeyPkcs8Pem } = keypairPem();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return { ok: true, status: 202, json: async () => ({ accepted: true, replayed: false, captureLeadId: 'cap-9' }) } as Response;
  }) as unknown as typeof fetch;

  const client = createServerCaptureClient({
    baseUrl: 'https://api.expadio.test/',
    tenantId: '11111111-1111-4111-8111-111111111111',
    sourceId: '22222222-2222-4222-8222-222222222222',
    privateKeyPkcs8Pem,
    fetchImpl: fakeFetch,
    idempotencyKey: () => 'idmp-server',
  });

  const result = await client.submit({ contact: { email: 'lead@example.com' } });
  assert.equal(result.captureLeadId, 'cap-9');

  const [{ url, init }] = calls;
  assert.equal(
    url,
    'https://api.expadio.test/api/lead-capture/ingest/22222222-2222-4222-8222-222222222222?tenantId=11111111-1111-4111-8111-111111111111',
  );
  const headers = init.headers as Record<string, string>;
  const ts = headers['x-expadio-capture-timestamp'];
  const signature = Buffer.from(headers['x-expadio-capture-signature'], 'base64');
  const body = new Uint8Array(init.body as ArrayBuffer);
  assert.equal(verify(null, Buffer.from(captureSigningBytes(ts, body)), publicKey, signature), true);
});
