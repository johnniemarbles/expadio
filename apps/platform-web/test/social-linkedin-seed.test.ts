import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const withoutSqlComments = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

const migration = read('../../../infra/db/migrations/0086_communication_social_channel.sql');
const migrationSql = withoutSqlComments(migration);
const smoke = read('../../../infra/db/tests/social_linkedin_connector_smoke.sql');
const worker = read('../lib/communication-delivery-worker.ts');
const sender = read('../../../packages/communication/src/sender.ts');
const prepare = read('../../../packages/communication/src/provider-send-request.ts');
const wiring = read('../../../docs/architecture/SOCIAL-COMMUNICATION-WIRING.md');
const checklist = read('../../../docs/platform/PLATFORM_COMPLETION_CHECKLIST.md');

test('0086 seeds communication.social.send and dark social.linkedin', () => {
  assert.match(migration, /communication\.social\.send/);
  assert.match(migration, /'Social — Send'/);
  assert.match(migration, /'social\.linkedin'/);
  assert.match(migration, /'social', 'linkedin', 'PLATFORM', NULL/);
  assert.match(migration, /'UNKNOWN', 200, false, false/);
  assert.match(migrationSql, /cap\.capability_key = 'communication\.social\.send'/);
  assert.match(migrationSql, /c\.connector_key = 'social\.linkedin'/);
  assert.doesNotMatch(migrationSql, /enabled\s*=\s*true/);
  assert.doesNotMatch(migrationSql, /PUBLISH_SOCIAL/);
  assert.doesNotMatch(migrationSql, /communication_sender_identities/);
});

test('seed-tenant smoke asserts disabled connector + capability bind + no sender channel', () => {
  assert.match(smoke, /connector_key = 'social\.linkedin'/);
  assert.match(smoke, /capability_key = 'communication\.social\.send'/);
  assert.match(smoke, /conn\.enabled IS NOT FALSE/);
  assert.match(smoke, /sender-identity CHECK must not include social/);
  assert.match(smoke, /'PLATFORM', 'social', 'urn:li:person:seed-proof'/);
});

test('worker and sender identity stay off social', () => {
  assert.match(worker, /ResendEmailAdapter/);
  assert.match(worker, /selected\.providerKey !== 'resend'/);
  assert.doesNotMatch(worker, /LinkedInSocialTextAdapter/);
  assert.doesNotMatch(worker, /linkedin-social-text-v1/);
  assert.doesNotMatch(worker, /governedLinkedInAccessTokenProvider/);
  assert.match(
    sender,
    /export type CommunicationSenderChannel = Extract<[\s\S]*'email' \| 'sms' \| 'whatsapp' \| 'voice' \| 'rcs'/, 
  );
  assert.match(prepare, /channel === 'rcs';/);
  assert.doesNotMatch(prepare, /channel === 'social'/);
});

test('checklist and wiring still treat the connector as dark', () => {
  assert.match(wiring, /enabled = false/);
  assert.match(wiring, /social\.linkedin/);
  assert.match(checklist, /social\.linkedin` PLATFORM \*\*enabled=false\*\*/);
  assert.match(checklist, /Delivery-worker social dispatch — forbidden/);
});
