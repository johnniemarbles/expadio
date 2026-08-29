import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const lib = read('../lib/governance-pending-reviews.ts');
const route = read('../app/api/governance/pending-reviews/route.ts');
const client = read('../app/(shell)/governance/pending/PendingReviewsClient.tsx');
const page = read('../app/(shell)/governance/pending/page.tsx');
const nav = read('../app/api/workspaces/route.ts');

test('pending reviews are open, assigned, not-yet-decided instances, filterable', () => {
  assert.match(lib, /FROM platform\.workflow_participant_assignments/);
  assert.match(lib, /JOIN platform\.workflow_instances/);
  assert.match(lib, /pa\.target_kind = 'USER'/);
  assert.match(lib, /pa\.status = 'ASSIGNED'/);
  assert.match(lib, /pa\.stage_key = i\.current_stage_key/);
  assert.match(lib, /state NOT IN \('COMPLETED','CANCELLED','FAILED'\)/);
  assert.match(lib, /NOT EXISTS/);
  assert.match(lib, /FROM platform\.workflow_stage_decisions/);
  // Team-wide: not scoped to one caller, but filterable by work type and assignee.
  assert.match(lib, /\$1 = '' OR i\.work_type_key = \$1/);
  assert.match(lib, /\$2 = '' OR pa\.target_key = \$2/);
  assert.match(lib, /ORDER BY i\.updated_at ASC/);
  // Surfaces who each item is waiting on.
  assert.match(lib, /pa\.target_key AS assignee/);
});

test('the pending-reviews route is a membership read behind RLS with filters', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /loadPendingReviews/);
  assert.match(route, /searchParams\.get\('workType'\)/);
  assert.match(route, /searchParams\.get\('assignee'\)/);
});

test('the pending-reviews surface shows the load per assignee and links from nav', () => {
  assert.match(page, /PendingReviewsClient/);
  assert.match(client, /Pending review load/);
  assert.match(client, /Waiting on/);
  assert.match(nav, /href: '\/governance\/pending'/);
});
