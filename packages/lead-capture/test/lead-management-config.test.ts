import assert from 'node:assert/strict';
import test from 'node:test';
import {
  approvalRequirementForChangeType,
  applyPublicationModeRestriction,
  buildRootConfig,
  classifyConfigTransition,
  maxApprovalRequirement,
  resolveEffectiveConfig,
  validateKeyOverride,
  type LeadManagementConfiguration,
} from '../src/lead-management-config.ts';
import { resolveInterestType } from '../src/interest-type-registry.ts';

// ── Approval requirement ──────────────────────────────────────────────────────

test('SELF_PUBLISHES: optional field addition needs no review', () => {
  assert.equal(approvalRequirementForChangeType('OPTIONAL_FIELD_ADDITION'), 'SELF_PUBLISHES');
});

test('PARENT_NOTIFICATION: operational routing and form labels notify but self-publish', () => {
  assert.equal(approvalRequirementForChangeType('OPERATIONAL_ROUTING_SLA'), 'PARENT_NOTIFICATION');
  assert.equal(approvalRequirementForChangeType('FORM_LABELS_ORDERING'), 'PARENT_NOTIFICATION');
  assert.equal(approvalRequirementForChangeType('QUALIFICATION_THRESHOLD_TIGHTENING'), 'PARENT_NOTIFICATION');
});

test('EXPLICIT_PARENT_APPROVAL: mandatory field changes and interest type activation', () => {
  assert.equal(approvalRequirementForChangeType('MANDATORY_FIELD_ADDITION'), 'EXPLICIT_PARENT_APPROVAL');
  assert.equal(approvalRequirementForChangeType('INTEREST_TYPE_ACTIVATION'), 'EXPLICIT_PARENT_APPROVAL');
});

test('PLATFORM_AUDIT_REQUIRED: compliance evidence changes', () => {
  assert.equal(approvalRequirementForChangeType('COMPLIANCE_EVIDENCE_REQUIREMENT'), 'PLATFORM_AUDIT_REQUIRED');
});

test('NOT_PERMITTED: mandatory platform field removal is blocked at any level', () => {
  assert.equal(approvalRequirementForChangeType('MANDATORY_PLATFORM_FIELD_REMOVAL'), 'NOT_PERMITTED');
});

test('maxApprovalRequirement returns the most restrictive requirement in a set', () => {
  assert.equal(
    maxApprovalRequirement(['SELF_PUBLISHES', 'PARENT_NOTIFICATION', 'EXPLICIT_PARENT_APPROVAL']),
    'EXPLICIT_PARENT_APPROVAL',
  );
  assert.equal(
    maxApprovalRequirement(['PARENT_NOTIFICATION', 'PLATFORM_AUDIT_REQUIRED']),
    'PLATFORM_AUDIT_REQUIRED',
  );
  assert.equal(
    maxApprovalRequirement(['NOT_PERMITTED', 'SELF_PUBLISHES']),
    'NOT_PERMITTED',
  );
  assert.equal(maxApprovalRequirement(['SELF_PUBLISHES']), 'SELF_PUBLISHES');
});

// ── State machine ─────────────────────────────────────────────────────────────

test('valid forward transitions are allowed', () => {
  const cases: Array<[Parameters<typeof classifyConfigTransition>[0], Parameters<typeof classifyConfigTransition>[1]]> = [
    ['DRAFT', 'PENDING_PARENT_REVIEW'],
    ['DRAFT', 'APPROVED'],
    ['PENDING_PARENT_REVIEW', 'ESCALATED'],
    ['PENDING_PARENT_REVIEW', 'APPROVED'],
    ['ESCALATED', 'APPROVED'],
    ['APPROVED', 'PUBLISHED'],
    ['PUBLISHED', 'SUPERSEDED'],
    ['EXPIRED_UNRESOLVED', 'DRAFT'],
  ];
  for (const [from, to] of cases) {
    assert.ok(classifyConfigTransition(from, to).allowed, `${from} → ${to} should be allowed`);
  }
});

test('invalid transitions are rejected', () => {
  const cases: Array<[Parameters<typeof classifyConfigTransition>[0], Parameters<typeof classifyConfigTransition>[1]]> = [
    ['APPROVED', 'DRAFT'],
    ['PUBLISHED', 'DRAFT'],
    ['PUBLISHED', 'PENDING_PARENT_REVIEW'],
    ['SUPERSEDED', 'DRAFT'],
    ['ESCALATED', 'PENDING_PARENT_REVIEW'],
  ];
  for (const [from, to] of cases) {
    assert.equal(classifyConfigTransition(from, to).allowed, false, `${from} → ${to} should not be allowed`);
  }
});

test('same-state transition is rejected', () => {
  const result = classifyConfigTransition('DRAFT', 'DRAFT');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'ALREADY_IN_STATE');
});

// ADR-017 Invariant 2: PENDING_PARENT_REVIEW never auto-approves on timeout.
test('timeout-driven escalation does not require ancestor action (system fires it)', () => {
  const escalation = classifyConfigTransition('PENDING_PARENT_REVIEW', 'ESCALATED');
  assert.ok(escalation.allowed);
  assert.equal(escalation.requiresAncestorAction, false, 'ESCALATED is system-driven, not ancestor-driven');
});

test('approval transitions require ancestor action', () => {
  const pendingToApproved = classifyConfigTransition('PENDING_PARENT_REVIEW', 'APPROVED');
  assert.ok(pendingToApproved.allowed);
  assert.equal(pendingToApproved.requiresAncestorAction, true);

  const escalatedToApproved = classifyConfigTransition('ESCALATED', 'APPROVED');
  assert.ok(escalatedToApproved.allowed);
  assert.equal(escalatedToApproved.requiresAncestorAction, true);
});

test('DRAFT → APPROVED is allowed and does not require ancestor action (self-publishing changes)', () => {
  const result = classifyConfigTransition('DRAFT', 'APPROVED');
  assert.ok(result.allowed);
  assert.equal(result.requiresAncestorAction, false);
});

// ── Key override validation ───────────────────────────────────────────────────

test('LOCKED: schemaKey cannot be overridden even with same domain', () => {
  const result = validateKeyOverride(
    'opportunity:franchise:single-unit:v1',
    'opportunity:franchise:single-unit:v2',
    'LOCKED',
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'KEY_OVERRIDE_LOCKED');
});

test('LOCKED: identical key is valid (no change)', () => {
  const result = validateKeyOverride(
    'opportunity:franchise:single-unit:v1',
    'opportunity:franchise:single-unit:v1',
    'LOCKED',
  );
  assert.ok(result.valid);
});

test('BOUNDED_SAME_DOMAIN: allows override within same domain', () => {
  const result = validateKeyOverride(
    'workflow:franchise:unit:v1',
    'workflow:franchise:unit:v2',
    'BOUNDED_SAME_DOMAIN',
  );
  assert.ok(result.valid);
});

test('BOUNDED_SAME_DOMAIN: rejects cross-domain override', () => {
  const result = validateKeyOverride(
    'workflow:franchise:unit:v1',
    'workflow:distribution:standard:v1',
    'BOUNDED_SAME_DOMAIN',
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'KEY_OVERRIDE_DOMAIN_MISMATCH');
});

test('OVERRIDABLE: allows any replacement key', () => {
  const result = validateKeyOverride(
    'routing:franchise:territory:v1',
    'routing:custom:regional:v1',
    'OVERRIDABLE',
  );
  assert.ok(result.valid);
});

// ── Publication mode restriction ──────────────────────────────────────────────

test('child can narrow the parent publication mode set', () => {
  const result = applyPublicationModeRestriction(
    ['HOSTED_FORM', 'JS_WIDGET', 'IFRAME', 'REST_API'],
    ['HOSTED_FORM', 'REST_API'],
  );
  assert.ok(result.valid);
  assert.deepEqual([...result.effectiveModes], ['HOSTED_FORM', 'REST_API']);
});

test('child cannot expand the parent publication mode set', () => {
  const result = applyPublicationModeRestriction(
    ['HOSTED_FORM', 'REST_API'],
    ['HOSTED_FORM', 'REST_API', 'JS_WIDGET'],
  );
  assert.equal(result.valid, false);
  assert.ok(result.reason?.includes('PUBLICATION_MODE_EXPANSION_NOT_PERMITTED'));
});

test('child cannot produce an empty publication mode set', () => {
  const result = applyPublicationModeRestriction(['HOSTED_FORM', 'REST_API'], []);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'PUBLICATION_MODES_CANNOT_BE_EMPTY');
});

test('identical parent and child mode sets are valid', () => {
  const result = applyPublicationModeRestriction(['HOSTED_FORM', 'REST_API'], ['HOSTED_FORM', 'REST_API']);
  assert.ok(result.valid);
});

// ── Root config builder ───────────────────────────────────────────────────────

test('buildRootConfig creates a DRAFT config from a registry entry', () => {
  const entry = resolveInterestType('FRANCHISEE', 'SINGLE_UNIT');
  assert.ok(entry);
  const config = buildRootConfig(entry, {
    configId: 'cfg-001',
    tenantId: 'tenant-001',
    organizationId: 'org-001',
    createdAt: '2026-09-01T00:00:00Z',
  });

  assert.equal(config.status, 'DRAFT');
  assert.equal(config.version, 1);
  assert.equal(config.parentConfigId, null);
  assert.equal(config.schemaKey, entry.schemaKey);
  assert.equal(config.workflowBlueprintKey, entry.workflowBlueprintKey);
  assert.equal(config.reviewSlaBusinessDays, 5);
  assert.equal(config.publishedAt, null);
});

test('buildRootConfig accepts a custom SLA within bounds', () => {
  const entry = resolveInterestType('FRANCHISEE', 'SINGLE_UNIT')!;
  const config = buildRootConfig(entry, {
    configId: 'cfg-002',
    tenantId: 'tenant-001',
    organizationId: 'org-001',
    reviewSlaBusinessDays: 3,
    createdAt: '2026-09-01T00:00:00Z',
  });
  assert.equal(config.reviewSlaBusinessDays, 3);
});

test('buildRootConfig throws for SLA out of bounds', () => {
  const entry = resolveInterestType('FRANCHISEE', 'SINGLE_UNIT')!;
  assert.throws(
    () => buildRootConfig(entry, { configId: 'x', tenantId: 't', organizationId: 'o', reviewSlaBusinessDays: 0, createdAt: '2026-09-01T00:00:00Z' }),
    /REVIEW_SLA_OUT_OF_BOUNDS/,
  );
  assert.throws(
    () => buildRootConfig(entry, { configId: 'x', tenantId: 't', organizationId: 'o', reviewSlaBusinessDays: 31, createdAt: '2026-09-01T00:00:00Z' }),
    /REVIEW_SLA_OUT_OF_BOUNDS/,
  );
});

// ── Effective config resolution ───────────────────────────────────────────────

function makePublishedConfig(
  overrides: Partial<LeadManagementConfiguration> & { configId: string },
): LeadManagementConfiguration {
  return {
    tenantId: 'tenant-001',
    organizationId: 'org-001',
    parentConfigId: null,
    interestType: 'FRANCHISEE',
    opportunityType: 'SINGLE_UNIT',
    schemaKey: 'opportunity:franchise:single-unit:v1',
    qualificationProfileKey: 'qualification:franchise:unit:v1',
    workflowBlueprintKey: 'workflow:franchise:unit:v1',
    evidenceProfileKey: 'evidence:franchise:unit:v1',
    defaultRoutingProfileKey: 'routing:franchise:territory:v1',
    supportedPublicationModes: ['HOSTED_FORM', 'JS_WIDGET', 'REST_API'],
    reviewSlaBusinessDays: 5,
    formCustomizations: null,
    status: 'PUBLISHED',
    version: 1,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    publishedAt: '2026-09-01T00:00:00Z',
    submittedForReviewAt: null,
    expiresAt: null,
    ...overrides,
  };
}

test('resolveEffectiveConfig with a single PUBLISHED root returns it unchanged', () => {
  const root = makePublishedConfig({ configId: 'cfg-root' });
  const result = resolveEffectiveConfig([root], '2026-09-04T00:00:00Z');
  assert.equal(result.status, 'RESOLVED');
  assert.ok(result.status === 'RESOLVED' && result.config);
  assert.deepEqual(result.config.inheritanceChain, ['cfg-root']);
  assert.equal(result.config.schemaKey, 'opportunity:franchise:single-unit:v1');
});

test('resolveEffectiveConfig returns UNRESOLVED when no PUBLISHED config in chain', () => {
  const draft = makePublishedConfig({ configId: 'cfg-draft', status: 'DRAFT', publishedAt: null });
  const result = resolveEffectiveConfig([draft], '2026-09-04T00:00:00Z');
  assert.equal(result.status, 'UNRESOLVED');
});

test('resolveEffectiveConfig applies valid child overrides', () => {
  const root = makePublishedConfig({ configId: 'cfg-root' });
  const child = makePublishedConfig({
    configId: 'cfg-child',
    parentConfigId: 'cfg-root',
    organizationId: 'org-child',
    defaultRoutingProfileKey: 'routing:franchise:territory:v2',
    reviewSlaBusinessDays: 3,
  });
  const result = resolveEffectiveConfig([root, child], '2026-09-04T00:00:00Z');
  assert.equal(result.status, 'RESOLVED');
  assert.ok(result.status === 'RESOLVED' && result.config);
  assert.equal(result.config.defaultRoutingProfileKey, 'routing:franchise:territory:v2');
  assert.equal(result.config.reviewSlaBusinessDays, 3);
  assert.deepEqual(result.config.inheritanceChain, ['cfg-root', 'cfg-child']);
});

test('resolveEffectiveConfig rejects cross-domain key override (fail-closed: parent value holds)', () => {
  const root = makePublishedConfig({ configId: 'cfg-root' });
  const child = makePublishedConfig({
    configId: 'cfg-child',
    parentConfigId: 'cfg-root',
    workflowBlueprintKey: 'workflow:distribution:standard:v1', // wrong domain
  });
  const result = resolveEffectiveConfig([root, child], '2026-09-04T00:00:00Z');
  assert.equal(result.status, 'RESOLVED');
  assert.ok(result.status === 'RESOLVED' && result.config);
  assert.equal(result.config.workflowBlueprintKey, 'workflow:franchise:unit:v1', 'parent key preserved');
});

test('resolveEffectiveConfig child cannot expand publication modes (fail-closed)', () => {
  const root = makePublishedConfig({
    configId: 'cfg-root',
    supportedPublicationModes: ['HOSTED_FORM', 'REST_API'],
  });
  const child = makePublishedConfig({
    configId: 'cfg-child',
    parentConfigId: 'cfg-root',
    supportedPublicationModes: ['HOSTED_FORM', 'REST_API', 'JS_WIDGET'],
  });
  const result = resolveEffectiveConfig([root, child], '2026-09-04T00:00:00Z');
  assert.equal(result.status, 'RESOLVED');
  assert.ok(result.status === 'RESOLVED' && result.config);
  assert.deepEqual(
    [...result.config.supportedPublicationModes],
    ['HOSTED_FORM', 'REST_API'],
    'parent modes preserved when child attempts expansion',
  );
});

test('resolveEffectiveConfig child can narrow publication modes', () => {
  const root = makePublishedConfig({
    configId: 'cfg-root',
    supportedPublicationModes: ['HOSTED_FORM', 'JS_WIDGET', 'REST_API'],
  });
  const child = makePublishedConfig({
    configId: 'cfg-child',
    parentConfigId: 'cfg-root',
    supportedPublicationModes: ['HOSTED_FORM'],
  });
  const result = resolveEffectiveConfig([root, child], '2026-09-04T00:00:00Z');
  assert.equal(result.status, 'RESOLVED');
  assert.ok(result.status === 'RESOLVED' && result.config);
  assert.deepEqual([...result.config.supportedPublicationModes], ['HOSTED_FORM']);
});

test('resolveEffectiveConfig skips configs published after effectiveAt', () => {
  const root = makePublishedConfig({ configId: 'cfg-root', publishedAt: '2026-09-01T00:00:00Z' });
  const futureChild = makePublishedConfig({
    configId: 'cfg-future',
    parentConfigId: 'cfg-root',
    publishedAt: '2026-09-10T00:00:00Z',
    reviewSlaBusinessDays: 2,
  });
  const result = resolveEffectiveConfig([root, futureChild], '2026-09-04T00:00:00Z');
  assert.equal(result.status, 'RESOLVED');
  assert.ok(result.status === 'RESOLVED' && result.config);
  assert.equal(result.config.reviewSlaBusinessDays, 5, 'future config not applied');
  assert.deepEqual(result.config.inheritanceChain, ['cfg-root']);
});

test('MASTER_FRANCHISEE root config preserves high-governance publication mode restriction', () => {
  const entry = resolveInterestType('MASTER_FRANCHISEE');
  assert.ok(entry);
  const config = buildRootConfig(entry, {
    configId: 'cfg-mf',
    tenantId: 'tenant-001',
    organizationId: 'org-001',
    createdAt: '2026-09-01T00:00:00Z',
  });
  assert.ok(!config.supportedPublicationModes.includes('JS_WIDGET'));
  assert.ok(!config.supportedPublicationModes.includes('QR_CODE'));
  assert.ok(config.supportedPublicationModes.includes('HOSTED_FORM'));
});
