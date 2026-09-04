import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyProvenanceFilter,
  buildEvidenceProfile,
  EvidenceProfileError,
  meetsMinimumProvenance,
  PROVENANCE_RANK,
  provenanceRank,
  type EvidenceProfile,
  type EvidenceProfileRequirement,
} from '../src/evidence-profile.ts';
import { buildQualificationFact } from '../src/qualification-provenance.ts';

// ── PROVENANCE_RANK ───────────────────────────────────────────────────────────

test('PROVENANCE_RANK: SELF_DECLARED is weakest (0)', () => {
  assert.equal(PROVENANCE_RANK.SELF_DECLARED, 0);
});

test('PROVENANCE_RANK: EXTERNAL_VERIFIED is strongest (4)', () => {
  assert.equal(PROVENANCE_RANK.EXTERNAL_VERIFIED, 4);
});

test('PROVENANCE_RANK: strictly ordered weakest to strongest', () => {
  assert.ok(PROVENANCE_RANK.SELF_DECLARED < PROVENANCE_RANK.SYSTEM_DERIVED);
  assert.ok(PROVENANCE_RANK.SYSTEM_DERIVED < PROVENANCE_RANK.OPERATOR_ASSESSED);
  assert.ok(PROVENANCE_RANK.OPERATOR_ASSESSED < PROVENANCE_RANK.DOCUMENT_VERIFIED);
  assert.ok(PROVENANCE_RANK.DOCUMENT_VERIFIED < PROVENANCE_RANK.EXTERNAL_VERIFIED);
});

test('provenanceRank: returns the numeric rank', () => {
  assert.equal(provenanceRank('OPERATOR_ASSESSED'), 2);
  assert.equal(provenanceRank('DOCUMENT_VERIFIED'), 3);
});

// ── meetsMinimumProvenance ────────────────────────────────────────────────────

test('meetsMinimumProvenance: same level meets itself', () => {
  assert.ok(meetsMinimumProvenance('DOCUMENT_VERIFIED', 'DOCUMENT_VERIFIED'));
});

test('meetsMinimumProvenance: stronger meets weaker minimum', () => {
  assert.ok(meetsMinimumProvenance('EXTERNAL_VERIFIED', 'OPERATOR_ASSESSED'));
});

test('meetsMinimumProvenance: weaker does not meet stronger minimum', () => {
  assert.ok(!meetsMinimumProvenance('SELF_DECLARED', 'OPERATOR_ASSESSED'));
});

test('meetsMinimumProvenance: SELF_DECLARED meets SELF_DECLARED minimum', () => {
  assert.ok(meetsMinimumProvenance('SELF_DECLARED', 'SELF_DECLARED'));
});

test('meetsMinimumProvenance: OPERATOR_ASSESSED does not meet DOCUMENT_VERIFIED minimum', () => {
  assert.ok(!meetsMinimumProvenance('OPERATOR_ASSESSED', 'DOCUMENT_VERIFIED'));
});

// ── buildEvidenceProfile ──────────────────────────────────────────────────────

const BASE_REQ: EvidenceProfileRequirement = {
  criterionKey: 'min_investment',
  minimumProvenanceLevel: 'OPERATOR_ASSESSED',
  mode: 'REQUIRED',
  blocksVerifiedScore: true,
};

const BASE_PROFILE_OPTIONS = {
  evidenceProfileId: 'ep-001',
  tenantId: 'tenant-001',
  organizationId: 'org-001',
  profileKey: 'evidence:franchise:standard:v1',
  name: 'Standard Franchise Evidence',
  version: 1,
  requirements: [BASE_REQ],
  createdAt: '2026-09-07T09:00:00Z',
};

test('buildEvidenceProfile: builds a DRAFT profile with valid input', () => {
  const profile = buildEvidenceProfile(BASE_PROFILE_OPTIONS);
  assert.equal(profile.status, 'DRAFT');
  assert.equal(profile.profileKey, 'evidence:franchise:standard:v1');
  assert.equal(profile.requirements.length, 1);
  assert.equal(profile.activatedAt, null);
  assert.equal(profile.retiredAt, null);
});

test('buildEvidenceProfile: accepts multiple requirements', () => {
  const profile = buildEvidenceProfile({
    ...BASE_PROFILE_OPTIONS,
    requirements: [
      { criterionKey: 'min_investment', minimumProvenanceLevel: 'DOCUMENT_VERIFIED', mode: 'REQUIRED', blocksVerifiedScore: true },
      { criterionKey: 'liquid_capital', minimumProvenanceLevel: 'OPERATOR_ASSESSED', mode: 'REQUIRED', blocksVerifiedScore: true },
      { criterionKey: 'prior_experience', minimumProvenanceLevel: 'SELF_DECLARED', mode: 'OPTIONAL', blocksVerifiedScore: false },
    ],
  });
  assert.equal(profile.requirements.length, 3);
});

test('buildEvidenceProfile: throws INVALID_PROFILE_KEY for wrong format', () => {
  assert.throws(
    () => buildEvidenceProfile({ ...BASE_PROFILE_OPTIONS, profileKey: 'qualification:franchise:standard:v1' }),
    (e: unknown) => e instanceof EvidenceProfileError && e.code === 'INVALID_PROFILE_KEY',
  );
});

test('buildEvidenceProfile: throws INVALID_PROFILE_KEY for missing segment', () => {
  assert.throws(
    () => buildEvidenceProfile({ ...BASE_PROFILE_OPTIONS, profileKey: 'evidence:franchise:v1' }),
    (e: unknown) => e instanceof EvidenceProfileError && e.code === 'INVALID_PROFILE_KEY',
  );
});

test('buildEvidenceProfile: throws EMPTY_REQUIREMENTS for empty array', () => {
  assert.throws(
    () => buildEvidenceProfile({ ...BASE_PROFILE_OPTIONS, requirements: [] }),
    (e: unknown) => e instanceof EvidenceProfileError && e.code === 'EMPTY_REQUIREMENTS',
  );
});

test('buildEvidenceProfile: throws DUPLICATE_CRITERION_KEY for repeated criterionKey', () => {
  assert.throws(
    () => buildEvidenceProfile({
      ...BASE_PROFILE_OPTIONS,
      requirements: [BASE_REQ, { ...BASE_REQ, mode: 'OPTIONAL' }],
    }),
    (e: unknown) => e instanceof EvidenceProfileError && e.code === 'DUPLICATE_CRITERION_KEY',
  );
});

test('buildEvidenceProfile: throws INVALID_VERSION for version 0', () => {
  assert.throws(
    () => buildEvidenceProfile({ ...BASE_PROFILE_OPTIONS, version: 0 }),
    (e: unknown) => e instanceof EvidenceProfileError && e.code === 'INVALID_VERSION',
  );
});

test('buildEvidenceProfile: throws UNKNOWN_PROVENANCE_LEVEL for invalid minimum', () => {
  assert.throws(
    () => buildEvidenceProfile({
      ...BASE_PROFILE_OPTIONS,
      requirements: [{ ...BASE_REQ, minimumProvenanceLevel: 'MAYBE_VERIFIED' as never }],
    }),
    (e: unknown) => e instanceof EvidenceProfileError && e.code === 'UNKNOWN_PROVENANCE_LEVEL',
  );
});

test('buildEvidenceProfile: throws MISSING_FIELD for blank name', () => {
  assert.throws(
    () => buildEvidenceProfile({ ...BASE_PROFILE_OPTIONS, name: '' }),
    (e: unknown) => e instanceof EvidenceProfileError && e.code === 'MISSING_FIELD',
  );
});

// ── applyProvenanceFilter ─────────────────────────────────────────────────────

const FACT_BASE = {
  qualificationId: 'q-001',
  captureLeadId: 'lead-001',
  tenantId: 'tenant-001',
  organizationId: 'org-001',
  qualificationTemplateId: 'tmpl-001',
  templateVersion: 1,
  criterionKey: 'min_investment',
  response: 'MEETS' as const,
  note: null,
  assessedBySubjectId: 'user|abc',
  assessedAt: '2026-09-07T10:00:00Z',
};

const PROFILE: EvidenceProfile = buildEvidenceProfile({
  ...BASE_PROFILE_OPTIONS,
  requirements: [
    { criterionKey: 'min_investment', minimumProvenanceLevel: 'OPERATOR_ASSESSED', mode: 'REQUIRED', blocksVerifiedScore: true },
    { criterionKey: 'liquid_capital', minimumProvenanceLevel: 'DOCUMENT_VERIFIED', mode: 'REQUIRED', blocksVerifiedScore: true },
    { criterionKey: 'prior_experience', minimumProvenanceLevel: 'SELF_DECLARED', mode: 'OPTIONAL', blocksVerifiedScore: false },
  ],
});

function makeFact(criterionKey: string, evidenceSource: string) {
  return buildQualificationFact({
    ...FACT_BASE,
    qualificationId: `q-${criterionKey}-${evidenceSource}`,
    criterionKey,
    evidenceSource,
  });
}

test('applyProvenanceFilter: no facts → all requirements unmet, blocking ones flagged', () => {
  const summary = applyProvenanceFilter([], PROFILE);
  assert.ok(summary.verifiedScoreBlocked);
  assert.equal(summary.blockingCriteria.length, 2); // min_investment + liquid_capital block
  const minInv = summary.results.find((r) => r.criterionKey === 'min_investment')!;
  assert.equal(minInv.strongestFact, null);
  assert.ok(!minInv.meetsRequirement);
  assert.ok(minInv.blocksVerifiedScore);
});

test('applyProvenanceFilter: self-declared fact below OPERATOR_ASSESSED minimum → blocks', () => {
  const facts = [makeFact('min_investment', 'SELF_DECLARED')];
  const summary = applyProvenanceFilter(facts, PROFILE);
  const result = summary.results.find((r) => r.criterionKey === 'min_investment')!;
  assert.ok(!result.meetsRequirement);
  assert.ok(result.blocksVerifiedScore);
  assert.ok(summary.verifiedScoreBlocked);
});

test('applyProvenanceFilter: operator-assessed meets OPERATOR_ASSESSED minimum → not blocking', () => {
  const facts = [
    makeFact('min_investment', 'OPERATOR_ASSESSED'),
    makeFact('liquid_capital', 'DOCUMENT_VERIFIED'),
  ];
  const summary = applyProvenanceFilter(facts, PROFILE);
  const minInv = summary.results.find((r) => r.criterionKey === 'min_investment')!;
  assert.ok(minInv.meetsRequirement);
  assert.ok(!minInv.blocksVerifiedScore);
});

test('applyProvenanceFilter: all required criteria met → verified score not blocked', () => {
  const facts = [
    makeFact('min_investment', 'DOCUMENT_VERIFIED'),
    makeFact('liquid_capital', 'DOCUMENT_VERIFIED'),
  ];
  const summary = applyProvenanceFilter(facts, PROFILE);
  assert.ok(!summary.verifiedScoreBlocked);
  assert.equal(summary.blockingCriteria.length, 0);
});

test('applyProvenanceFilter: EXTERNAL_VERIFIED exceeds DOCUMENT_VERIFIED minimum → meets', () => {
  const facts = [
    makeFact('min_investment', 'EXTERNAL_VERIFIED'),
    makeFact('liquid_capital', 'EXTERNAL_VERIFIED'),
  ];
  const summary = applyProvenanceFilter(facts, PROFILE);
  assert.ok(!summary.verifiedScoreBlocked);
});

test('applyProvenanceFilter: selects strongest fact when multiple exist for same criterion', () => {
  const facts = [
    makeFact('min_investment', 'SELF_DECLARED'),
    makeFact('min_investment', 'DOCUMENT_VERIFIED'), // strongest
  ];
  const summary = applyProvenanceFilter(facts, PROFILE);
  const result = summary.results.find((r) => r.criterionKey === 'min_investment')!;
  assert.equal(result.strongestFact?.evidenceSource, 'DOCUMENT_VERIFIED');
  assert.ok(result.meetsRequirement);
});

test('applyProvenanceFilter: OPTIONAL criterion with no fact does not block verified score', () => {
  const facts = [
    makeFact('min_investment', 'OPERATOR_ASSESSED'),
    makeFact('liquid_capital', 'DOCUMENT_VERIFIED'),
    // prior_experience absent
  ];
  const summary = applyProvenanceFilter(facts, PROFILE);
  const exp = summary.results.find((r) => r.criterionKey === 'prior_experience')!;
  assert.equal(exp.strongestFact, null);
  assert.ok(!exp.meetsRequirement);
  assert.ok(!exp.blocksVerifiedScore); // OPTIONAL
  assert.ok(!summary.verifiedScoreBlocked); // required ones are met
});

test('applyProvenanceFilter: returns a result for every profile requirement', () => {
  const summary = applyProvenanceFilter([], PROFILE);
  assert.equal(summary.results.length, PROFILE.requirements.length);
});

test('applyProvenanceFilter: SELF_DECLARED minimum allows self-declared fact', () => {
  const facts = [
    makeFact('min_investment', 'OPERATOR_ASSESSED'),
    makeFact('liquid_capital', 'DOCUMENT_VERIFIED'),
    makeFact('prior_experience', 'SELF_DECLARED'),
  ];
  const summary = applyProvenanceFilter(facts, PROFILE);
  const exp = summary.results.find((r) => r.criterionKey === 'prior_experience')!;
  assert.ok(exp.meetsRequirement);
  assert.ok(!exp.blocksVerifiedScore);
  assert.ok(!summary.verifiedScoreBlocked);
});
