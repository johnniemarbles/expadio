import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SocialSendGateError,
  assertConnectorReady,
  buildSocialCommunicationIntent,
  fileSocialCommunicationIntent,
  readSocialLinkedInConnector,
  toGovernedCommunicateIntent,
  type SocialContentTouch,
} from '../lib/social-communication.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const touch: SocialContentTouch = {
  contentItemId: '55555555-5555-4555-8555-555555555555',
  slotKey: 'linkedin-slot-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  body: 'We just closed the communication lease path.',
  recipientSubjectId: 'urn:li:person:abc123',
  stageKey: 'APPROVED',
  authorSubjectId: 'author-1',
};

const darkConnector = {
  connectorKey: 'social.linkedin' as const,
  enabled: false,
  providerKey: 'linkedin',
};

test('builds a Communication intent only after APPROVED and SoD', () => {
  const intent = buildSocialCommunicationIntent({ touch, actorSubjectId: 'reviewer-1' });
  assert.equal(intent.capabilityKey, 'communication.social.send');
  assert.equal(intent.connectorKey, 'social.linkedin');
  assert.equal(intent.providerKey, 'linkedin');
  assert.equal(intent.sendRequest.channel, 'social');
  assert.equal(intent.sendRequest.purpose, 'marketing');
  assert.equal(intent.sendRequest.recipient.subjectId, 'urn:li:person:abc123');
  assert.match(intent.sendRequest.idempotencyKey, /social\.content_publish/);
});

test('maps the filed touch onto a COMMUNICATE Action Intent without dispatch', () => {
  const social = buildSocialCommunicationIntent({ touch, actorSubjectId: 'reviewer-1' });
  const action = toGovernedCommunicateIntent({
    social,
    actorSubjectId: 'reviewer-1',
    contentItemId: touch.contentItemId,
    slotKey: touch.slotKey,
  });
  assert.equal(action.executorClass, 'COMMUNICATE');
  assert.equal(action.actionKey, 'social.linkedin.send');
  assert.equal(action.configuration.capabilityKey, 'communication.social.send');
  assert.equal(action.configuration.channel, 'social');
  assert.equal(action.idempotencyKey, social.sendRequest.idempotencyKey);
});

test('author cannot file the Communication intent', () => {
  assert.throws(
    () => buildSocialCommunicationIntent({ touch, actorSubjectId: 'author-1' }),
    (err: unknown) => err instanceof SocialSendGateError && err.code === 'SEPARATION_OF_DUTIES',
  );
});

test('unapproved content cannot file the Communication intent', () => {
  assert.throws(
    () => buildSocialCommunicationIntent({
      touch: { ...touch, stageKey: 'BRAND_REVIEW' },
      actorSubjectId: 'reviewer-1',
    }),
    (err: unknown) => err instanceof SocialSendGateError && err.code === 'NOT_APPROVED',
  );
});

test('disabled social.linkedin stays dark and is readable without throwing on persist path', () => {
  assert.deepEqual(
    readSocialLinkedInConnector(darkConnector),
    { ready: false, code: 'CONNECTOR_DISABLED' },
  );
  assert.throws(
    () => assertConnectorReady(darkConnector),
    (err: unknown) => err instanceof SocialSendGateError && err.code === 'CONNECTOR_DISABLED',
  );

  const filed = fileSocialCommunicationIntent({
    touch,
    actorSubjectId: 'reviewer-1',
    connector: darkConnector,
  });
  assert.equal(filed.sent, false);
  assert.equal(filed.dispatched, false);
  assert.equal(filed.persisted, true);
  assert.equal(filed.reasonKey, 'CONNECTOR_DISABLED');
  assert.equal(filed.actionIntent.executorClass, 'COMMUNICATE');
});

test('missing copy or recipient subject is rejected', () => {
  assert.throws(
    () => buildSocialCommunicationIntent({
      touch: { ...touch, body: '   ' },
      actorSubjectId: 'reviewer-1',
    }),
    (err: unknown) => err instanceof SocialSendGateError && err.code === 'INVALID_TOUCH',
  );
  assert.throws(
    () => buildSocialCommunicationIntent({
      touch: { ...touch, recipientSubjectId: '' },
      actorSubjectId: 'reviewer-1',
    }),
    (err: unknown) => err instanceof SocialSendGateError && err.code === 'INVALID_TOUCH',
  );
});

test('seam never dispatches, never adds PUBLISH_SOCIAL, never merges #482 subject table', () => {
  const lib = read('../lib/social-communication.ts');
  const worker = read('../lib/communication-delivery-worker.ts');
  const verticals = read('../lib/verticals.ts');
  assert.match(lib, /persistGovernedActionIntent|toGovernedCommunicateIntent/);
  assert.match(lib, /CONNECTOR_DISABLED/);
  assert.doesNotMatch(lib, /executeGovernedCommunicateAction/);
  assert.doesNotMatch(lib, /PUBLISH_SOCIAL/);
  assert.doesNotMatch(lib, /social_content_items/);
  assert.doesNotMatch(verticals, /SOCIAL_CONTENT_WORKFLOW/);
  assert.doesNotMatch(verticals, /social\.content_publish/);
  assert.match(worker, /providerKey !== 'resend'/);
  assert.doesNotMatch(worker, /linkedin-social-text-v1/);
  assert.doesNotMatch(worker, /governedLinkedInAccessTokenProvider/);
});
