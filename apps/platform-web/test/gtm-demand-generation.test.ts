import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const withoutSqlComments = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

const migration = read('../../../infra/db/migrations/0082_gtm_demand_generation.sql');
const migrationSql = withoutSqlComments(migration);
const verticals = read('../lib/verticals.ts');
const icpWorkflow = read('../app/api/gtm/icps/[id]/workflow/route.ts');
const campaignDecision = read('../app/api/gtm/campaigns/[id]/workflow/decision/route.ts');
const campaignParticipants = read('../app/api/gtm/campaigns/[id]/workflow/participants/route.ts');
const listRoute = read('../app/api/gtm/icps/route.ts');
const sequenceRoute = read('../app/api/gtm/sequences/route.ts');
const meetingRoute = read('../app/api/gtm/meeting-requests/route.ts');
const replyRoute = read('../app/api/gtm/replies/route.ts');
const communicate = read('../app/api/gtm/sequences/[id]/communicate/route.ts');
const client = read('../app/(shell)/gtm/GtmClient.tsx');
const nav = read('../app/api/workspaces/route.ts');
const lead = read('../../../packages/lead/src/index.ts');
const queue = read('../app/(shell)/governance/queue/ReviewQueueClient.tsx');

test('gtm tables, four blueprints, disabled connector, no lab adapter', () => {
  assert.match(migration, /CREATE TABLE platform\.gtm_icps/);
  assert.match(migration, /CREATE TABLE platform\.gtm_sequences/);
  assert.match(migration, /CREATE TABLE platform\.gtm_campaigns/);
  assert.match(migration, /CREATE TABLE platform\.gtm_meeting_requests/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /tenant_id = platform\.current_tenant_id\(\)/);
  assert.match(migration, /NULL, 'gtm\.icp\.publish', 1/);
  assert.match(migration, /NULL, 'gtm\.sequence\.publish', 1/);
  assert.match(migration, /NULL, 'gtm\.campaign\.launch', 1/);
  assert.match(migration, /NULL, 'gtm\.meeting_request', 1/);
  assert.match(migration, /"decisionRequired": true/);
  assert.match(migration, /"autoAdvance": false/);
  assert.match(migration, /'gtm\.email'/);
  assert.match(migration, /false, false/);
  assert.match(migration, /outbound_gtm/);
  assert.match(migration, /raw_payload/);
  assert.doesNotMatch(migrationSql, /gtm-email-lab-v1/);
  assert.doesNotMatch(migrationSql, /SEND_OUTBOUND/);
});

test('verticals and factory routes bind the four GTM work types', () => {
  assert.match(verticals, /subjectType: 'gtm\.icp\.publish'/);
  assert.match(verticals, /subjectType: 'gtm\.sequence\.publish'/);
  assert.match(verticals, /subjectType: 'gtm\.campaign\.launch'/);
  assert.match(verticals, /subjectType: 'gtm\.meeting_request'/);
  assert.match(icpWorkflow, /createVerticalWorkflowRoute\(GTM_ICP_WORKFLOW\)/);
  assert.match(campaignDecision, /createVerticalDecisionRoute\(GTM_CAMPAIGN_WORKFLOW\)/);
  assert.match(campaignParticipants, /createVerticalParticipantsRoute\(GTM_CAMPAIGN_WORKFLOW\)/);
  assert.match(listRoute, /INSERT INTO platform\.gtm_icps/);
  assert.match(listRoute, /hasGovernanceWriteRole/);
  assert.match(sequenceRoute, /INSERT INTO platform\.gtm_sequences/);
  assert.match(meetingRoute, /INSERT INTO platform\.gtm_meeting_requests/);
  assert.match(replyRoute, /OUTBOUND_GTM_LEAD_SOURCE/);
  assert.match(communicate, /persistGovernedActionIntent/);
  assert.match(communicate, /toGovernedCommunicateIntent/);
  assert.match(communicate, /dispatched: false/);
  assert.doesNotMatch(communicate, /executeGovernedCommunicateAction/);
});

test('console, nav, lead source and review queue know AutoGTM', () => {
  assert.match(client, /Propose ICP/);
  assert.match(client, /File sequence draft/);
  assert.match(client, /File campaign draft/);
  assert.match(client, /outbound_gtm/);
  assert.match(client, /gtm\.email/);
  assert.doesNotMatch(client, /gtm-email-lab-v1/);
  assert.match(nav, /href: '\/gtm'/);
  assert.match(lead, /OUTBOUND_GTM_LEAD_SOURCE = 'outbound_gtm'/);
  assert.match(queue, /'gtm\.campaign\.launch': '\/gtm'/);
});
