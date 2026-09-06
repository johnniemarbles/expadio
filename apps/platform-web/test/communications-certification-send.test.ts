import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const route = read('../app/api/communications/providers/[key]/certification-send/route.ts');
const webhook = read('../lib/communication-provider-webhook.ts');
const reconciliation = read('../lib/communication-certification-reconciliation.ts');
const migration = read('../../../infra/db/migrations/0143_communication_certification_requests.sql');
const modal = read('../app/(shell)/communications/ConnectorActionsModal.tsx');

test('Certification Send enters the durable governed COMMUNICATE spine', () => {
  assert.match(route, /appendDomainEventWithOutbox/);
  assert.match(route, /persistGovernedActionIntent/);
  assert.match(route, /executeGovernedCommunicateActionInTransaction/);
  assert.match(route, /communication_certification_requests/);
  assert.match(route, /certificationStatus: 'CERTIFYING'/);
  assert.match(route, /CERTIFICATION_CONNECTOR_ROUTE_MISMATCH/);
  assert.doesNotMatch(route, /\.send\(/);
  assert.doesNotMatch(route, /ResendEmailAdapter|TwilioSmsWhatsappAdapter|TwilioVoiceAdapter/);
  assert.doesNotMatch(route, /TEST_SEND_OK/);
});

test('certification request is durable, tenant isolated, and deployment bound', () => {
  assert.match(migration, /CREATE TABLE (IF NOT EXISTS )?platform\.communication_certification_requests/);
  assert.match(migration, /delivery_id uuid NOT NULL/);
  assert.match(migration, /action_intent_id uuid NOT NULL/);
  assert.match(migration, /commit_sha text NOT NULL/);
  assert.match(migration, /status text NOT NULL DEFAULT 'CERTIFYING'/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /FOR DELETE USING \(false\)/);
  assert.match(migration, /communications\.live-certification/);
});

test('only signed terminal webhook reconciliation can materialize LIVE certification', () => {
  assert.match(webhook, /reconcileCommunicationCertification/);
  assert.match(webhook, /webhook_event_id/);
  assert.match(reconciliation, /SIGNED_PROVIDER_WEBHOOK/);
  assert.match(reconciliation, /provider_attempt\.outcome = 'ACCEPTED'/);
  assert.match(reconciliation, /execution_attempt\.status = 'QUEUED'/);
  assert.match(reconciliation, /input\.finalDeliveryState === 'DELIVERED'/);
  assert.match(reconciliation, /'LIVE_CERTIFIED'/);
});

test('connector actions modal exposes durable live certification controls', () => {
  assert.match(modal, /\$\{base\}\/certification-send\$\{queryString\}/);
  assert.match(modal, /requestId:\s*certificationRequestId\.trim\(\)/);
  assert.match(modal, /setCertificationRequestId\(makeUuid\(\)\)/);
  assert.match(modal, /Queue certification/);
  assert.match(modal, /LIVE requires a signed terminal provider webhook/);
});
