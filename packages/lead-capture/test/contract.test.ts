import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CAPTURE_BODY_BYTES,
  serializeSubmission,
  stableStringify,
  type CaptureSubmission,
} from '../src/contract.ts';
import { extractLeadFields, normalizeEmail, normalizePhone, normalizeSubmission } from '../src/normalize.ts';
import { createBrowserCaptureClient } from '../src/client.ts';

const hasCode = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

test('email is required and normalized; obvious invalids rejected', () => {
  assert.equal(normalizeEmail('  Lead@Example.COM '), 'lead@example.com');
  assert.throws(() => normalizeEmail(''), hasCode('CAPTURE_EMAIL_REQUIRED'));
  assert.throws(() => normalizeEmail('not-an-email'), hasCode('CAPTURE_EMAIL_INVALID'));
});

test('phone tidies to digits with an optional leading plus', () => {
  assert.equal(normalizePhone(' +1 (415) 555-2671 '), '+14155552671');
  assert.equal(normalizePhone('n/a'), undefined);
  assert.equal(normalizePhone(undefined), undefined);
});

test('normalize builds the canonical wire shape and a sensible title', () => {
  const s = normalizeSubmission({
    contact: { email: 'A@B.com', firstName: ' Ada ', lastName: 'Lovelace', phone: '+1 415 555 0000' },
    organization: { name: '  Analytical Engines ' },
    consent: [{ channel: 'EMAIL', purpose: 'MARKETING', granted: true, textVersion: 'v3' }],
    fields: { plan: ' pro ', seats: 12, agreed: true, ignored: { nope: 1 } as never },
  });
  assert.equal(s.contact.email, 'a@b.com');
  assert.equal(s.title, 'Ada Lovelace');
  assert.equal(s.organization?.name, 'Analytical Engines');
  assert.deepEqual(s.consent, [{ channel: 'EMAIL', purpose: 'MARKETING', granted: true, textVersion: 'v3' }]);
  assert.equal(s.fields.plan, 'pro');
  assert.equal(s.fields.seats, 12);
  assert.equal(s.fields.agreed, true);
  assert.ok(!('ignored' in s.fields), 'non-scalar field values are dropped');
});

test('normalize never accepts scope or stage from the client', () => {
  const s = normalizeSubmission({
    contact: { email: 'a@b.com' },
    // These are not part of the input type and must not survive onto the wire.
    ...( { tenantId: 'forged', organizationId: 'forged', stage: 'WON', captureLayerId: 'forged' } as object ),
  } as never);
  const wire = JSON.parse(new TextDecoder().decode(serializeSubmission(s)));
  for (const forbidden of ['tenantId', 'organizationId', 'stage', 'captureLayerId']) {
    assert.ok(!(forbidden in wire), `${forbidden} must not appear on the wire`);
  }
});

test('title falls back to email when no name is given', () => {
  const s = normalizeSubmission({ contact: { email: 'solo@example.com' } });
  assert.equal(s.title, 'New enquiry from solo@example.com');
});

test('extractLeadFields is a superset of the current server extraction', () => {
  const s = normalizeSubmission({ contact: { email: 'a@b.com', firstName: 'Ada', phone: '+15550000' }, externalReference: 'form-9' });
  assert.deepEqual(extractLeadFields(s), {
    title: 'Ada',
    email: 'a@b.com',
    firstName: 'Ada',
    lastName: undefined,
    phone: '+15550000',
    externalReference: 'form-9',
  });
});

test('stableStringify sorts keys so equal submissions serialize identically', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
  const a = normalizeSubmission({ contact: { email: 'a@b.com' }, organization: { name: 'X' } });
  const b = normalizeSubmission({ organization: { name: 'X' }, contact: { email: 'a@b.com' } } as never);
  assert.equal(stableStringify(a), stableStringify(b));
});

test('serialize enforces the ingress size bound as a backstop', () => {
  // Bypass the per-field cap to exercise the whole-body guard directly.
  const huge: CaptureSubmission = {
    contact: { email: 'a@b.com' },
    consent: [],
    attribution: {},
    title: 'oversized',
    fields: { blob: 'x'.repeat(MAX_CAPTURE_BODY_BYTES) },
  };
  assert.throws(() => serializeSubmission(huge), hasCode('CAPTURE_PAYLOAD_TOO_LARGE'));
});

test('browser client posts publishable key + idempotency, merges page attribution', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return {
      ok: true,
      status: 202,
      json: async () => ({ accepted: true, replayed: false, captureLeadId: 'cap-1', requiresVerification: true }),
    } as Response;
  }) as unknown as typeof fetch;

  const client = createBrowserCaptureClient({
    baseUrl: 'https://api.expadio.test/',
    tenantId: '11111111-1111-4111-8111-111111111111',
    sourceId: '22222222-2222-4222-8222-222222222222',
    publishableKey: `cpk_${'a'.repeat(40)}`,
    fetchImpl: fakeFetch,
    captureAttribution: false,
    idempotencyKey: () => 'idmp-fixed',
  });

  const result = await client.submit({ contact: { email: 'lead@example.com' }, attribution: { utmSource: 'newsletter' } });
  assert.equal(result.accepted, true);
  assert.equal(result.requiresVerification, true);
  assert.equal(result.captureLeadId, 'cap-1');

  const [{ url, init }] = calls;
  assert.equal(url, 'https://api.expadio.test/api/lead-capture/public/22222222-2222-4222-8222-222222222222?tenantId=11111111-1111-4111-8111-111111111111');
  const headers = init.headers as Record<string, string>;
  assert.equal(headers['x-expadio-capture-key'], `cpk_${'a'.repeat(40)}`);
  assert.equal(headers['x-expadio-idempotency-key'], 'idmp-fixed');
  const sent = JSON.parse(new TextDecoder().decode(init.body as Uint8Array));
  assert.equal(sent.attribution.utmSource, 'newsletter');
});

test('browser client verify posts the code to the verify URL and reads the outcome', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return { ok: false, status: 401, json: async () => ({ verified: false, reason: 'INVALID', remainingAttempts: 4 }) } as Response;
  }) as unknown as typeof fetch;
  const client = createBrowserCaptureClient({
    baseUrl: 'https://api.expadio.test',
    tenantId: '11111111-1111-4111-8111-111111111111',
    sourceId: '22222222-2222-4222-8222-222222222222',
    publishableKey: `cpk_${'a'.repeat(40)}`,
    fetchImpl: fakeFetch,
  });
  const result = await client.verify('33333333-3333-4333-8333-333333333333', '000000');
  assert.deepEqual(result, { verified: false, reason: 'INVALID', remainingAttempts: 4 });
  assert.match(calls[0].url, /\/api\/lead-capture\/public\/22222222-2222-4222-8222-222222222222\/verify\?tenantId=/);
});

test('browser client refuses an invalid publishable key', () => {
  assert.throws(() => createBrowserCaptureClient({
    baseUrl: 'https://x.test',
    tenantId: '11111111-1111-4111-8111-111111111111',
    sourceId: '22222222-2222-4222-8222-222222222222',
    publishableKey: 'sk_secret_looking',
  }), /valid publishable key/);
});
