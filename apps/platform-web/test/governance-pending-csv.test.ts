import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { toPendingReviewsCsv, PENDING_CSV_HEADER } from '../lib/governance-pending-csv.ts';
import type { PendingReview } from '../lib/governance-pending-reviews.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

function item(over: Partial<PendingReview> = {}): PendingReview {
  return {
    workTypeKey: 'vendor.onboarding',
    subjectType: 'vendor',
    subjectId: 'v-1',
    subjectLabel: 'Globex',
    state: 'RUNNING',
    currentStageKey: 'APPROVAL',
    participantKey: 'reviewer',
    assigneeSubjectId: 'alice',
    waitingSince: '2026-08-29T00:00:00.000Z',
    ...over,
  };
}

test('the pending CSV has the header then one row per item, label then id', () => {
  const csv = toPendingReviewsCsv([item()]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], PENDING_CSV_HEADER.join(','));
  assert.equal(lines[1], 'vendor.onboarding,Globex,v-1,APPROVAL,reviewer,alice,2026-08-29T00:00:00.000Z');
});

test('a missing label becomes an empty field, not the string null', () => {
  const csv = toPendingReviewsCsv([item({ subjectLabel: null })]);
  assert.equal(csv.split('\r\n')[1], 'vendor.onboarding,,v-1,APPROVAL,reviewer,alice,2026-08-29T00:00:00.000Z');
});

test('the pending export route is a membership read behind RLS and the page links to it', () => {
  const route = read('../app/api/governance/pending-reviews/export/route.ts');
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /loadPendingReviews/);
  assert.match(route, /toPendingReviewsCsv/);
  assert.match(route, /text\/csv/);
  assert.match(route, /attachment; filename="pending-review-load\.csv"/);
  const client = read('../app/(shell)/governance/pending/PendingReviewsClient.tsx');
  assert.match(client, /\/api\/governance\/pending-reviews\/export/);
  assert.match(client, /Download CSV/);
});
