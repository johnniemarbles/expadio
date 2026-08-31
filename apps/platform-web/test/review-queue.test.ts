import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const lib = read('../lib/governance-review-queue.ts');
const route = read('../app/api/governance/queue/route.ts');
const client = read('../app/(shell)/governance/queue/ReviewQueueClient.tsx');
const page = read('../app/(shell)/governance/queue/page.tsx');
const productNav = read('../lib/platform-product-surface.ts');

test('the queue returns open instances awaiting the given subject, not yet decided', () => {
  assert.match(lib, /FROM platform\.workflow_participant_assignments/);
  assert.match(lib, /JOIN platform\.workflow_instances/);
  assert.match(lib, /pa\.target_kind = 'USER'/);
  assert.match(lib, /pa\.target_key = \$1/);
  assert.match(lib, /pa\.status = 'ASSIGNED'/);
  assert.match(lib, /pa\.stage_key = i\.current_stage_key/);
  assert.match(lib, /state NOT IN \('COMPLETED','CANCELLED','FAILED'\)/);
  assert.match(lib, /NOT EXISTS/);
  assert.match(lib, /FROM platform\.workflow_stage_decisions/);
  assert.match(lib, /ORDER BY i\.updated_at ASC/);
  assert.match(lib, /COALESCE\(ve\.legal_name, cc\.subject, er\.purpose, ar\.resource\) AS subject_label/);
  assert.match(lib, /LEFT JOIN platform\.vendors ve/);
});

test('the queue route is a membership read behind RLS, scoped to the caller', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /loadReviewQueue/);
  assert.match(route, /subjectId: context\.subjectId/);
});

test('the queue surface lists pending work and is the Platform My work href', () => {
  assert.match(page, /ReviewQueueClient/);
  assert.match(client, /Your review queue/);
  assert.match(client, /style=\{badge\}>\{items\.length\}/);
  assert.match(client, /\/api\/governance\/actions\?workType=/);
  assert.match(client, /action: 'DECIDE'/);
  assert.match(client, /method: 'POST'/);
  assert.match(client, /setItems\(\(prev\) => prev\.filter/);
  assert.match(page, /\/api\/tenancy\/vertical/);
  assert.match(page, /verticalKey=\{verticalKey\}/);
  assert.match(client, /resolveWorkTypeLabel\(pack, d\.workTypeKey\)/);
  assert.match(client, /resolveStageLabel\(pack, d\.workTypeKey, d\.currentStageKey\)/);
  assert.match(client, /'crm\.case': '\/crm'/);
  assert.match(client, /'vendor\.onboarding': '\/vendors'/);
  assert.match(client, /'expense\.reimbursement': '\/expenses'/);
  assert.match(client, /'access\.request': '\/access-requests'/);
  assert.match(productNav, /href: '\/governance\/queue'/);
});
