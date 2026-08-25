import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresCommunicationConsentRepository } from '../src/consent.ts';
import type { PostgresClient, SqlQueryResult } from '../src/index.ts';

class ScriptedClient implements PostgresClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  readonly responses: SqlQueryResult[] = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return (this.responses.shift() ?? { rows: [], rowCount: 0 }) as SqlQueryResult<Row>;
  }
}

const consentRow = {
  consent_event_id: '11111111-1111-1111-1111-111111111111',
  tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  organization_id: '22222222-2222-2222-2222-222222222222',
  subject_id: 'subject-1',
  recipient_key: 'person@example.com',
  channel: 'email',
  purpose: 'marketing',
  event_type: 'GRANTED',
  source: 'FORM',
  policy_version: 'privacy-v3',
  evidence_ref: 'capture:consent-1',
  effective_at: '2026-08-25T03:00:00.000Z',
  expires_at: null,
  recorded_at: '2026-08-25T03:01:00.000Z',
};

test('record appends provider-neutral consent evidence and maps the persisted event', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [consentRow], rowCount: 1 });

  const event = await new PostgresCommunicationConsentRepository(client).record({
    tenantId: consentRow.tenant_id,
    organizationId: consentRow.organization_id,
    subjectId: 'subject-1',
    recipientKey: consentRow.recipient_key,
    channel: 'email',
    purpose: 'marketing',
    eventType: 'GRANTED',
    source: 'FORM',
    policyVersion: 'privacy-v3',
    evidenceRef: 'capture:consent-1',
    effectiveAt: '2026-08-25T03:00:00.000Z',
  });

  assert.deepEqual(event, {
    consentEventId: consentRow.consent_event_id,
    tenantId: consentRow.tenant_id,
    organizationId: consentRow.organization_id,
    subjectId: 'subject-1',
    recipientKey: consentRow.recipient_key,
    channel: 'email',
    purpose: 'marketing',
    eventType: 'GRANTED',
    source: 'FORM',
    policyVersion: 'privacy-v3',
    evidenceRef: 'capture:consent-1',
    effectiveAt: '2026-08-25T03:00:00.000Z',
    recordedAt: '2026-08-25T03:01:00.000Z',
  });
  assert.deepEqual(client.calls[0]?.values, [
    consentRow.tenant_id,
    consentRow.organization_id,
    'subject-1',
    consentRow.recipient_key,
    'email',
    'marketing',
    'GRANTED',
    'FORM',
    'privacy-v3',
    'capture:consent-1',
    '2026-08-25T03:00:00.000Z',
    null,
  ]);
});

test('resolveEffective prefers an applicable organization event over tenant-wide consent', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [consentRow], rowCount: 1 });

  const result = await new PostgresCommunicationConsentRepository(client).resolveEffective({
    tenantId: consentRow.tenant_id,
    organizationId: consentRow.organization_id,
    recipientKey: 'PERSON@EXAMPLE.COM',
    channel: 'email',
    purpose: 'marketing',
    at: '2026-08-25T03:30:00.000Z',
  });

  assert.equal(result.granted, true);
  assert.equal(result.scope, 'ORGANIZATION');
  assert.equal(result.event?.consentEventId, consentRow.consent_event_id);
  assert.deepEqual(client.calls[0]?.values, [
    consentRow.tenant_id,
    consentRow.organization_id,
    'PERSON@EXAMPLE.COM',
    'email',
    'marketing',
    '2026-08-25T03:30:00.000Z',
  ]);
  assert.match(client.calls[0]?.text ?? '', /ORDER BY \(organization_id IS NOT NULL\) DESC/);
  assert.match(client.calls[0]?.text ?? '', /expires_at IS NULL OR expires_at >/);
});

test('resolveEffective treats a withdrawal as fail-closed tenant consent', async () => {
  const client = new ScriptedClient();
  client.responses.push({
    rows: [{ ...consentRow, organization_id: null, event_type: 'WITHDRAWN' }],
    rowCount: 1,
  });

  const result = await new PostgresCommunicationConsentRepository(client).resolveEffective({
    tenantId: consentRow.tenant_id,
    recipientKey: consentRow.recipient_key,
    channel: 'email',
    purpose: 'marketing',
  });

  assert.deepEqual(
    { granted: result.granted, scope: result.scope, eventType: result.event?.eventType },
    { granted: false, scope: 'TENANT', eventType: 'WITHDRAWN' },
  );
  assert.equal(client.calls[0]?.values[1], null);
  assert.match(client.calls[0]?.text ?? '', /\$2::uuid IS NULL AND organization_id IS NULL/);
});

test('resolveEffective returns NONE and false when no applicable event exists', async () => {
  const client = new ScriptedClient();
  client.responses.push({ rows: [], rowCount: 0 });

  const result = await new PostgresCommunicationConsentRepository(client).resolveEffective({
    tenantId: consentRow.tenant_id,
    recipientKey: consentRow.recipient_key,
    channel: 'sms',
    purpose: 'marketing',
  });

  assert.deepEqual(result, { granted: false, scope: 'NONE', event: null });
});
