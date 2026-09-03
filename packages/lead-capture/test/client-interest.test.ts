import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserCaptureClient } from '../src/client.ts';
import { stableStringify, type CaptureInterestSubmissionInput } from '../src/contract.ts';

const publishableKey = `cpk_${'A'.repeat(32)}`;

const interestSubmission: CaptureInterestSubmissionInput = {
  contact: { email: ' Owner@Example.COM ', firstName: 'Ada', lastName: 'Owner' },
  consent: [{ channel: 'EMAIL', purpose: 'ENQUIRY_FOLLOW_UP', granted: true, textVersion: 'v1' }],
  attribution: { pageUrl: 'https://brand.example/franchise', utmSource: 'campaign' },
  interest: {
    interestType: 'FRANCHISEE',
    opportunityType: 'SINGLE_UNIT',
    person: {
      firstName: 'Ada',
      lastName: 'Owner',
      email: 'owner@example.com',
      countryCode: 'CA',
    },
    business: {
      hasExistingBusiness: false,
    },
    locationSought: [{ countryCode: 'CA', city: 'Toronto' }],
    investmentBudgetMinorUnits: 5000000,
  },
};

test('browser capture client submits strict commercial-interest payloads', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createBrowserCaptureClient({
    baseUrl: 'https://platform.example/',
    tenantId: 'tenant-1',
    sourceId: 'source-1',
    publishableKey,
    idempotencyKey: () => 'idmp-test',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ accepted: true, replayed: false, captureLeadId: 'lead-1', requiresVerification: true }), { status: 202 });
    },
  });

  const result = await client.submitInterest(interestSubmission);

  assert.equal(result.accepted, true);
  assert.equal(result.captureLeadId, 'lead-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://platform.example/api/lead-capture/public/source-1?tenantId=tenant-1');
  const headers = calls[0]?.init.headers as Record<string, string>;
  assert.equal(headers['x-expadio-capture-key'], publishableKey);
  assert.equal(headers['x-expadio-idempotency-key'], 'idmp-test');

  const body = calls[0]?.init.body as Uint8Array;
  const parsed = JSON.parse(new TextDecoder().decode(body)) as Record<string, any>;
  assert.equal(parsed.contact.email, 'owner@example.com');
  assert.equal(parsed.interest.interestType, 'FRANCHISEE');
  assert.equal(parsed.consent[0].purpose, 'ENQUIRY_FOLLOW_UP');
  assert.equal(parsed.attribution.utmSource, 'campaign');
  assert.equal(new TextDecoder().decode(body), stableStringify(parsed));
});

test('browser interest submit enforces strict consent attribution and typed interest before network', async () => {
  let called = false;
  const client = createBrowserCaptureClient({
    baseUrl: 'https://platform.example',
    tenantId: 'tenant-1',
    sourceId: 'source-1',
    publishableKey,
    captureAttribution: false,
    fetchImpl: async () => {
      called = true;
      return new Response('{}', { status: 202 });
    },
  });

  await assert.rejects(
    () => client.submitInterest({ ...interestSubmission, attribution: undefined } as never),
    (error: unknown) => (error as { code?: string }).code === 'CAPTURE_ATTRIBUTION_REQUIRED',
  );
  await assert.rejects(
    () => client.submitInterest({ ...interestSubmission, consent: undefined } as never),
    (error: unknown) => (error as { code?: string }).code === 'CAPTURE_CONSENT_REQUIRED',
  );
  await assert.rejects(
    () => client.submitInterest({ ...interestSubmission, interest: undefined } as never),
    (error: unknown) => (error as { code?: string }).code === 'CAPTURE_INTEREST_REQUIRED',
  );
  assert.equal(called, false);
});
