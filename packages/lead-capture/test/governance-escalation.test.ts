import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addBusinessDays,
  analyseEscalationChain,
  buildEscalationEntry,
  businessDaysElapsed,
  classifyReviewDeadline,
  computeExpiryAt,
  type EscalationEntry,
} from '../src/governance-escalation.ts';

// ── businessDaysElapsed ───────────────────────────────────────────────────────

test('businessDaysElapsed: same date returns 0', () => {
  const d = new Date('2026-09-07T09:00:00Z'); // Monday
  assert.equal(businessDaysElapsed(d, d), 0);
});

test('businessDaysElapsed: to < from returns 0', () => {
  const from = new Date('2026-09-08T00:00:00Z');
  const to = new Date('2026-09-07T00:00:00Z');
  assert.equal(businessDaysElapsed(from, to), 0);
});

test('businessDaysElapsed: Mon to Fri of same week = 4', () => {
  const from = new Date('2026-09-07T00:00:00Z'); // Monday
  const to = new Date('2026-09-11T23:59:59Z');   // Friday
  assert.equal(businessDaysElapsed(from, to), 4);
});

test('businessDaysElapsed: Mon to Mon next week = 5', () => {
  const from = new Date('2026-09-07T00:00:00Z'); // Monday
  const to = new Date('2026-09-14T00:00:00Z');   // Monday next week
  assert.equal(businessDaysElapsed(from, to), 5);
});

test('businessDaysElapsed: Fri to Mon = 1 (weekend excluded)', () => {
  const from = new Date('2026-09-04T00:00:00Z'); // Friday
  const to = new Date('2026-09-07T00:00:00Z');   // Monday
  assert.equal(businessDaysElapsed(from, to), 1);
});

test('businessDaysElapsed: Fri to Fri next week = 5', () => {
  const from = new Date('2026-09-04T00:00:00Z'); // Friday
  const to = new Date('2026-09-11T00:00:00Z');   // Friday next week
  assert.equal(businessDaysElapsed(from, to), 5);
});

test('businessDaysElapsed: Fri to Sat = 0 (Saturday not counted)', () => {
  const from = new Date('2026-09-04T00:00:00Z'); // Friday
  const to = new Date('2026-09-05T00:00:00Z');   // Saturday
  assert.equal(businessDaysElapsed(from, to), 0);
});

// ── addBusinessDays ───────────────────────────────────────────────────────────

test('addBusinessDays: 5 days from Monday lands on following Monday', () => {
  const start = new Date('2026-09-07T00:00:00Z'); // Monday
  const result = addBusinessDays(start, 5);
  assert.equal(result.toISOString().slice(0, 10), '2026-09-14');
});

test('addBusinessDays: 1 day from Friday lands on Monday', () => {
  const start = new Date('2026-09-04T00:00:00Z'); // Friday
  const result = addBusinessDays(start, 1);
  assert.equal(result.toISOString().slice(0, 10), '2026-09-07'); // Monday
});

test('addBusinessDays: 3 days from Wednesday lands on Monday', () => {
  const start = new Date('2026-09-09T00:00:00Z'); // Wednesday
  const result = addBusinessDays(start, 3);
  assert.equal(result.toISOString().slice(0, 10), '2026-09-14'); // Monday
});

// ── computeExpiryAt ───────────────────────────────────────────────────────────

test('computeExpiryAt: 5-day SLA from Monday expires on following Monday', () => {
  const expiry = computeExpiryAt('2026-09-07T09:00:00Z', 5);
  assert.ok(expiry.startsWith('2026-09-14'));
});

test('computeExpiryAt: 3-day escalation SLA from Friday expires on Wednesday', () => {
  const expiry = computeExpiryAt('2026-09-04T09:00:00Z', 3);
  assert.ok(expiry.startsWith('2026-09-09')); // Fri+3 biz = Mon+Tue+Wed = Sep 9
});

test('computeExpiryAt throws for invalid date', () => {
  assert.throws(() => computeExpiryAt('not-a-date', 5), /INVALID_SUBMITTED_AT/);
});

test('computeExpiryAt throws for SLA < 1', () => {
  assert.throws(() => computeExpiryAt('2026-09-07T00:00:00Z', 0), /INVALID_SLA_BUSINESS_DAYS/);
});

// ── classifyReviewDeadline ────────────────────────────────────────────────────

test('classifyReviewDeadline: within SLA returns ON_TIME', () => {
  // Submitted Monday, 5-day SLA, checking on Wednesday (2 biz days)
  const status = classifyReviewDeadline(
    '2026-09-07T09:00:00Z',
    5,
    '2026-09-09T09:00:00Z', // Wednesday
  );
  assert.equal(status, 'ON_TIME');
});

test('classifyReviewDeadline: exactly at SLA boundary is OVERDUE', () => {
  // Submitted Monday, 5-day SLA, checking on following Monday (5 biz days)
  const status = classifyReviewDeadline(
    '2026-09-07T00:00:00Z',
    5,
    '2026-09-14T00:00:00Z',
  );
  assert.equal(status, 'OVERDUE');
});

test('classifyReviewDeadline: past SLA returns OVERDUE', () => {
  const status = classifyReviewDeadline(
    '2026-09-07T00:00:00Z',
    5,
    '2026-09-21T00:00:00Z', // two weeks later
  );
  assert.equal(status, 'OVERDUE');
});

// ADR-017 Invariant 2: OVERDUE does not mean approved — it means escalation should fire.
test('OVERDUE means escalation fires, not auto-approval (invariant 2)', () => {
  const status = classifyReviewDeadline(
    '2026-09-07T00:00:00Z',
    5,
    '2026-09-21T00:00:00Z',
  );
  // The result tells us to escalate, NOT to auto-approve.
  assert.equal(status, 'OVERDUE');
  // Callers must trigger PENDING_PARENT_REVIEW → ESCALATED (a system action),
  // never PENDING_PARENT_REVIEW → APPROVED (which requiresAncestorAction = true).
});

// ── buildEscalationEntry ──────────────────────────────────────────────────────

test('buildEscalationEntry builds a PENDING entry with default 3-day SLA', () => {
  const entry = buildEscalationEntry({
    escalationId: 'esc-001',
    configId: 'cfg-001',
    fromOrganizationId: 'org-unit',
    toOrganizationId: 'org-region',
    escalatedAt: '2026-09-07T00:00:00Z', // Monday
  });

  assert.equal(entry.outcome, 'PENDING');
  assert.equal(entry.resolvedAt, null);
  assert.equal(entry.toOrganizationId, 'org-region');
  // 3 business days from Monday = Thursday
  assert.ok(entry.expiresAt.startsWith('2026-09-10'));
});

test('buildEscalationEntry with null toOrganizationId marks chain end', () => {
  const entry = buildEscalationEntry({
    escalationId: 'esc-002',
    configId: 'cfg-001',
    fromOrganizationId: 'org-brand-hq',
    toOrganizationId: null, // escalation chain exhausted
    escalatedAt: '2026-09-07T00:00:00Z',
  });
  assert.equal(entry.toOrganizationId, null);
  assert.equal(entry.outcome, 'PENDING');
});

// ── analyseEscalationChain ────────────────────────────────────────────────────

const SUBMITTED_AT = '2026-09-07T00:00:00Z'; // Monday
const SLA_5 = 5;

test('no entries + within SLA = AWAITING_INITIAL_REVIEW', () => {
  const analysis = analyseEscalationChain(
    [],
    SUBMITTED_AT,
    SLA_5,
    '2026-09-09T00:00:00Z', // Wednesday (2 biz days)
  );
  assert.equal(analysis.status, 'AWAITING_INITIAL_REVIEW');
  assert.equal(analysis.currentEntry, null);
});

test('no entries + overdue = ESCALATED_OVERDUE (transition should fire)', () => {
  const analysis = analyseEscalationChain(
    [],
    SUBMITTED_AT,
    SLA_5,
    '2026-09-21T00:00:00Z', // two weeks later
  );
  assert.equal(analysis.status, 'ESCALATED_OVERDUE');
  assert.equal(analysis.currentEntry, null);
});

test('pending escalation entry within 3-day window = ESCALATED_PENDING', () => {
  const entry: EscalationEntry = buildEscalationEntry({
    escalationId: 'esc-001',
    configId: 'cfg-001',
    fromOrganizationId: 'org-unit',
    toOrganizationId: 'org-region',
    escalatedAt: '2026-09-14T00:00:00Z', // Monday
  });
  const analysis = analyseEscalationChain(
    [entry],
    SUBMITTED_AT,
    SLA_5,
    '2026-09-15T00:00:00Z', // Tuesday (1 biz day in)
  );
  assert.equal(analysis.status, 'ESCALATED_PENDING');
  assert.ok(analysis.currentEntry !== null);
});

test('pending escalation entry past 3-day window = ESCALATED_OVERDUE', () => {
  const entry: EscalationEntry = buildEscalationEntry({
    escalationId: 'esc-001',
    configId: 'cfg-001',
    fromOrganizationId: 'org-unit',
    toOrganizationId: 'org-region',
    escalatedAt: '2026-09-14T00:00:00Z', // Monday
  });
  const analysis = analyseEscalationChain(
    [entry],
    SUBMITTED_AT,
    SLA_5,
    '2026-09-18T00:00:00Z', // Friday (4 biz days in — past 3-day window)
  );
  assert.equal(analysis.status, 'ESCALATED_OVERDUE');
});

test('null toOrganizationId = CHAIN_EXHAUSTED (EXPIRED_UNRESOLVED should fire)', () => {
  const entry: EscalationEntry = buildEscalationEntry({
    escalationId: 'esc-002',
    configId: 'cfg-001',
    fromOrganizationId: 'org-brand-hq',
    toOrganizationId: null,
    escalatedAt: '2026-09-21T00:00:00Z',
  });
  const analysis = analyseEscalationChain(
    [entry],
    SUBMITTED_AT,
    SLA_5,
    '2026-09-21T00:00:00Z',
  );
  assert.equal(analysis.status, 'CHAIN_EXHAUSTED');
});

test('most recent entry is used when multiple entries exist', () => {
  const first: EscalationEntry = buildEscalationEntry({
    escalationId: 'esc-001',
    configId: 'cfg-001',
    fromOrganizationId: 'org-unit',
    toOrganizationId: 'org-region',
    escalatedAt: '2026-09-14T00:00:00Z',
  });
  const second: EscalationEntry = buildEscalationEntry({
    escalationId: 'esc-002',
    configId: 'cfg-001',
    fromOrganizationId: 'org-region',
    toOrganizationId: 'org-brand-hq',
    escalatedAt: '2026-09-17T00:00:00Z', // Thursday
  });
  // Checking on Sep 18 (Friday) — 1 biz day into the second escalation's 3-day window
  const analysis = analyseEscalationChain(
    [first, second],
    SUBMITTED_AT,
    SLA_5,
    '2026-09-18T00:00:00Z',
  );
  assert.equal(analysis.status, 'ESCALATED_PENDING');
  assert.equal(analysis.currentEntry?.escalationId, 'esc-002');
});
