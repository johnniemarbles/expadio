import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const lib = read('../lib/governance-pending-reviews.ts');
const route = read('../app/api/governance/pending-reviews/route.ts');
const client = read('../app/(shell)/governance/pending/PendingReviewsClient.tsx');
const page = read('../app/(shell)/governance/pending/page.tsx');
const hub = read('../app/(shell)/governance/GovernanceToolsDirectory.tsx');
const productNav = read('../lib/platform-product-surface.ts');

test('pending reviews are open, assigned, not-yet-decided instances, filterable', () => {
  assert.match(lib, /FROM platform\.workflow_participant_assignments/);
  assert.match(lib, /JOIN platform\.workflow_instances/);
  assert.match(lib, /pa\.target_kind = 'USER'/);
  assert.match(lib, /pa\.status = 'ASSIGNED'/);
  assert.match(lib, /pa\.stage_key = i\.current_stage_key/);
  assert.match(lib, /state NOT IN \('COMPLETED','CANCELLED','FAILED'\)/);
  assert.match(lib, /NOT EXISTS/);
  assert.match(lib, /FROM platform\.workflow_stage_decisions/);
  assert.match(lib, /\$1 = '' OR i\.work_type_key = \$1/);
  assert.match(lib, /\$2 = '' OR pa\.target_key = \$2/);
  assert.match(lib, /ORDER BY i\.updated_at ASC/);
  assert.match(lib, /pa\.target_key AS assignee/);
  assert.match(lib, /COALESCE\(ve\.legal_name, cc\.subject, er\.purpose, ar\.resource\) AS subject_label/);
  assert.match(lib, /LEFT JOIN platform\.expense_reports er/);
});

test('the pending-reviews route is a membership read behind RLS with filters', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /loadPendingReviews/);
  assert.match(route, /searchParams\.get\('workType'\)/);
  assert.match(route, /searchParams\.get\('assignee'\)/);
});

test('the pending-reviews surface shows the load per assignee and the hub links to it', () => {
  assert.match(page, /PendingReviewsClient/);
  assert.match(client, /Pending review load/);
  assert.match(client, /style=\{badge\}>\{initial\.length\}/);
  assert.match(page, /\/api\/tenancy\/vertical/);
  assert.match(page, /verticalKey=\{verticalKey\}/);
  assert.match(client, /resolveWorkTypeLabel\(pack, d\.workTypeKey\)/);
  assert.match(client, /resolveStageLabel\(pack, d\.workTypeKey, d\.currentStageKey\)/);
  assert.match(client, /Waiting on/);
  assert.match(hub, /href: '\/governance\/pending'/);
  assert.doesNotMatch(productNav, /href: '\/governance\/pending'/);
});
