import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GtmSendGateError,
  assertConnectorReady,
  buildGtmCommunicationIntent,
  readGtmEmailConnector,
  shouldConvertReplyToLead,
  toGovernedCommunicateIntent,
  type GtmSequenceTouch,
} from '../lib/gtm-communication.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const touch: GtmSequenceTouch = {
  sequenceId: '44444444-4444-4444-8444-444444444444',
  stepKey: 'touch-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  subject: 'Northwind — a sharper ops loop',
  body: 'Hi Priya',
  recipientEmail: 'priya.shah@northwind-plants.example',
  stageKey: 'APPROVED',
  authorSubjectId: 'author-1',
};

test('builds a Communication intent only after APPROVED and SoD', () => {
  const intent = buildGtmCommunicationIntent({ touch, actorSubjectId: 'reviewer-1' });
  assert.equal(intent.capabilityKey, 'communication.email.send');
  assert.equal(intent.connectorKey, 'gtm.email');
  assert.equal(intent.providerKey, 'resend');
  assert.equal(intent.sendRequest.purpose, 'marketing');
  assert.match(intent.sendRequest.idempotencyKey, /gtm\.sequence\.publish/);
});

test('maps the filed touch onto a COMMUNICATE Action Intent without dispatch', () => {
  const gtm = buildGtmCommunicationIntent({ touch, actorSubjectId: 'reviewer-1' });
  const action = toGovernedCommunicateIntent({
    gtm,
    actorSubjectId: 'reviewer-1',
    sequenceId: touch.sequenceId,
    stepKey: touch.stepKey,
  });
  assert.equal(action.executorClass, 'COMMUNICATE');
  assert.equal(action.actionKey, 'gtm.email.send');
  assert.equal(action.configuration.capabilityKey, 'communication.email.send');
  assert.equal(action.idempotencyKey, gtm.sendRequest.idempotencyKey);
});

test('author cannot file the Communication intent', () => {
  assert.throws(
    () => buildGtmCommunicationIntent({ touch, actorSubjectId: 'author-1' }),
    (err: unknown) => err instanceof GtmSendGateError && err.code === 'SEPARATION_OF_DUTIES',
  );
});

test('unapproved sequence cannot file the Communication intent', () => {
  assert.throws(
    () => buildGtmCommunicationIntent({
      touch: { ...touch, stageKey: 'COPY_REVIEW' },
      actorSubjectId: 'reviewer-1',
    }),
    (err: unknown) => err instanceof GtmSendGateError && err.code === 'NOT_APPROVED',
  );
});

test('disabled gtm.email stays dark and is readable without throwing on persist path', () => {
  assert.deepEqual(
    readGtmEmailConnector({ connectorKey: 'gtm.email', enabled: false, providerKey: 'resend' }),
    { ready: false, code: 'CONNECTOR_DISABLED' },
  );
  assert.throws(
    () => assertConnectorReady({ connectorKey: 'gtm.email', enabled: false, providerKey: 'resend' }),
    (err: unknown) => err instanceof GtmSendGateError && err.code === 'CONNECTOR_DISABLED',
  );
});

test('warm interested and meeting replies convert to CRM leads', () => {
  assert.equal(shouldConvertReplyToLead('interested'), true);
  assert.equal(shouldConvertReplyToLead('meeting_requested'), true);
  assert.equal(shouldConvertReplyToLead('unsubscribe'), false);
});

test('platform communicate route persists and never dispatches or uses the lab adapter', () => {
  const route = read('../app/api/gtm/sequences/[id]/communicate/route.ts');
  const lib = read('../lib/gtm-communication.ts');
  assert.match(route, /persistGovernedActionIntent/);
  assert.match(route, /toGovernedCommunicateIntent/);
  assert.match(route, /dispatched: false/);
  assert.doesNotMatch(route, /executeGovernedCommunicateAction/);
  assert.doesNotMatch(route, /gtm-email-lab-v1/);
  assert.doesNotMatch(route, /SEND_OUTBOUND/);
  assert.doesNotMatch(lib, /gtm-email-lab-v1/);
});
