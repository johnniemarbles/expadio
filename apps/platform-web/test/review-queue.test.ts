import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const lib = read('../lib/governance-review-queue.ts');
const route = read('../app/api/governance/queue/route.ts');
const client = read('../app/(shell)/governance/queue/ReviewQueueClient.tsx');
const page = read('../app/(shell)/governance/queue/page.tsx');
const nav = read('../app/api/workspaces/route.ts');

test('the queue returns open instances awaiting the given subject, not yet decided', () => {
  assert.match(lib, /FROM platform\.workflow_participant_assignments/);
  assert.match(lib, /JOIN platform\.workflow_instances/);
  // Assigned to this user, on the stage the instance currently sits at.
  assert.match(lib, /pa\.target_kind = 'USER'/);
  assert.match(lib, /pa\.target_key = \$1/);
  assert.match(lib, /pa\.status = 'ASSIGNED'/);
  assert.match(lib, /pa\.stage_key = i\.current_stage_key/);
  // Open only, and only while no decision has been recorded for that stage.
  assert.match(lib, /state NOT IN \('COMPLETED','CANCELLED','FAILED'\)/);
  assert.match(lib, /NOT EXISTS/);
  assert.match(lib, /FROM platform\.workflow_stage_decisions/);
  // Worked by age — oldest waiting first.
  assert.match(lib, /ORDER BY i\.updated_at ASC/);
});

test('the queue route is a membership read behind RLS, scoped to the caller', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /loadReviewQueue/);
  assert.match(route, /subjectId: context\.subjectId/);
});

test('the queue surface lists pending work and links to each vertical', () => {
  assert.match(page, /ReviewQueueClient/);
  assert.match(client, /Your review queue/);
  assert.match(client, /'crm\.case': '\/crm'/);
  assert.match(client, /'vendor\.onboarding': '\/vendors'/);
  assert.match(client, /'expense\.reimbursement': '\/expenses'/);
  assert.match(client, /'access\.request': '\/access-requests'/);
  assert.match(nav, /href: '\/governance\/queue'/);
});
