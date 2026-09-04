import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listPlatformEvidenceProfiles,
  listPlatformQualificationProfiles,
  resolvePlatformEvidenceRequirements,
  resolvePlatformQualificationCriteria,
} from '../src/commercial-opportunity-pack.ts';
import {
  REGISTRY_EVIDENCE_PROFILE_KEYS,
  REGISTRY_QUALIFICATION_PROFILE_KEYS,
} from '../src/interest-type-registry.ts';

// ── Coverage: every registry key has a Platform default ──────────────────────

test('every registry qualificationProfileKey has a Platform default', () => {
  const missing: string[] = [];
  for (const key of REGISTRY_QUALIFICATION_PROFILE_KEYS) {
    if (resolvePlatformQualificationCriteria(key) === undefined) missing.push(key);
  }
  assert.deepEqual(missing, [], `Missing Platform defaults for qualification keys: ${missing.join(', ')}`);
});

test('every registry evidenceProfileKey has a Platform default', () => {
  const missing: string[] = [];
  for (const key of REGISTRY_EVIDENCE_PROFILE_KEYS) {
    if (resolvePlatformEvidenceRequirements(key) === undefined) missing.push(key);
  }
  assert.deepEqual(missing, [], `Missing Platform defaults for evidence keys: ${missing.join(', ')}`);
});

// ── Qualification profile integrity ──────────────────────────────────────────

test('every qualification profile has at least one criterion', () => {
  for (const profile of listPlatformQualificationProfiles()) {
    assert.ok(
      profile.criteria.length > 0,
      `${profile.profileKey} has no criteria`,
    );
  }
});

test('criterion keys within each qualification profile are unique', () => {
  for (const profile of listPlatformQualificationProfiles()) {
    const keys = profile.criteria.map((c) => c.criterionKey);
    const unique = new Set(keys);
    assert.equal(unique.size, keys.length, `Duplicate criterion keys in ${profile.profileKey}`);
  }
});

test('all criteria have non-blank criterionKey, label, and description', () => {
  for (const profile of listPlatformQualificationProfiles()) {
    for (const c of profile.criteria) {
      assert.ok(c.criterionKey.trim() !== '', `Blank criterionKey in ${profile.profileKey}`);
      assert.ok(c.label.trim() !== '', `Blank label for ${c.criterionKey}`);
      assert.ok(c.description.trim() !== '', `Blank description for ${c.criterionKey}`);
    }
  }
});

// ── Evidence profile integrity ────────────────────────────────────────────────

test('every evidence profile has at least one requirement', () => {
  for (const profile of listPlatformEvidenceProfiles()) {
    assert.ok(
      profile.requirements.length > 0,
      `${profile.profileKey} has no requirements`,
    );
  }
});

test('criterion keys within each evidence profile are unique', () => {
  for (const profile of listPlatformEvidenceProfiles()) {
    const keys = profile.requirements.map((r) => r.criterionKey);
    const unique = new Set(keys);
    assert.equal(unique.size, keys.length, `Duplicate criterionKeys in ${profile.profileKey}`);
  }
});

test('all evidence requirements have valid mode and provenance level', () => {
  const validModes = new Set(['REQUIRED', 'CONDITIONAL', 'OPTIONAL']);
  const validProvenance = new Set([
    'SELF_DECLARED', 'SYSTEM_DERIVED', 'OPERATOR_ASSESSED',
    'DOCUMENT_VERIFIED', 'EXTERNAL_VERIFIED',
  ]);
  for (const profile of listPlatformEvidenceProfiles()) {
    for (const r of profile.requirements) {
      assert.ok(validModes.has(r.mode), `Invalid mode ${r.mode} in ${profile.profileKey}`);
      assert.ok(
        validProvenance.has(r.minimumProvenanceLevel),
        `Invalid provenance ${r.minimumProvenanceLevel} in ${profile.profileKey}`,
      );
    }
  }
});

// ── Franchise-specific invariants ─────────────────────────────────────────────

test('franchise unit: investment_capacity is REQUIRED with DOCUMENT_VERIFIED minimum', () => {
  const profile = resolvePlatformEvidenceRequirements('evidence:franchise:unit:v1')!;
  const req = profile.requirements.find((r) => r.criterionKey === 'investment_capacity')!;
  assert.equal(req.mode, 'REQUIRED');
  assert.equal(req.minimumProvenanceLevel, 'DOCUMENT_VERIFIED');
  assert.ok(req.blocksVerifiedScore);
});

test('franchise unit: liquid_capital blocks verified score', () => {
  const profile = resolvePlatformEvidenceRequirements('evidence:franchise:unit:v1')!;
  const req = profile.requirements.find((r) => r.criterionKey === 'liquid_capital')!;
  assert.ok(req.blocksVerifiedScore);
});

test('franchise resale: prior_business_experience is REQUIRED at OPERATOR_ASSESSED (higher bar than unit)', () => {
  const unit = resolvePlatformEvidenceRequirements('evidence:franchise:unit:v1')!;
  const resale = resolvePlatformEvidenceRequirements('evidence:franchise:resale:v1')!;

  const unitExp = unit.requirements.find((r) => r.criterionKey === 'prior_business_experience')!;
  const resaleExp = resale.requirements.find((r) => r.criterionKey === 'prior_business_experience')!;

  assert.equal(unitExp.mode, 'OPTIONAL');
  assert.equal(resaleExp.mode, 'REQUIRED');
  assert.equal(resaleExp.minimumProvenanceLevel, 'OPERATOR_ASSESSED');
  assert.ok(resaleExp.blocksVerifiedScore);
});

test('franchise master: investment_capacity and liquid_capital require EXTERNAL_VERIFIED', () => {
  const profile = resolvePlatformEvidenceRequirements('evidence:franchise:master:v1')!;
  for (const key of ['investment_capacity', 'liquid_capital']) {
    const req = profile.requirements.find((r) => r.criterionKey === key)!;
    assert.equal(req.minimumProvenanceLevel, 'EXTERNAL_VERIFIED', `${key} should be EXTERNAL_VERIFIED`);
    assert.ok(req.blocksVerifiedScore);
  }
});

test('franchise master: has 6 requirements (highest bar)', () => {
  const profile = resolvePlatformEvidenceRequirements('evidence:franchise:master:v1')!;
  assert.equal(profile.requirements.length, 6);
});

test('franchise area-development: liquid_capital requires EXTERNAL_VERIFIED', () => {
  const profile = resolvePlatformEvidenceRequirements('evidence:franchise:area-development:v1')!;
  const req = profile.requirements.find((r) => r.criterionKey === 'liquid_capital')!;
  assert.equal(req.minimumProvenanceLevel, 'EXTERNAL_VERIFIED');
});

// ── Distribution-specific invariants ──────────────────────────────────────────

test('distribution standard: trade_references requires DOCUMENT_VERIFIED', () => {
  const profile = resolvePlatformEvidenceRequirements('evidence:distribution:standard:v1')!;
  const req = profile.requirements.find((r) => r.criterionKey === 'trade_references')!;
  assert.equal(req.minimumProvenanceLevel, 'DOCUMENT_VERIFIED');
  assert.ok(req.blocksVerifiedScore);
});

test('distribution master: is a superset of standard requirements', () => {
  const standard = resolvePlatformEvidenceRequirements('evidence:distribution:standard:v1')!;
  const master = resolvePlatformEvidenceRequirements('evidence:distribution:master:v1')!;
  const standardKeys = new Set(standard.requirements.map((r) => r.criterionKey));
  for (const req of standard.requirements) {
    assert.ok(
      master.requirements.some((r) => r.criterionKey === req.criterionKey),
      `master distribution missing ${req.criterionKey} from standard`,
    );
  }
  assert.ok(master.requirements.length > standard.requirements.length);
  // extra criterion
  assert.ok(master.requirements.some((r) => !standardKeys.has(r.criterionKey)));
});

// ── Agent-specific invariants ─────────────────────────────────────────────────

test('agent: training_completion is SYSTEM_DERIVED (cannot be self-declared)', () => {
  const profile = resolvePlatformEvidenceRequirements('evidence:agent:standard:v1')!;
  const req = profile.requirements.find((r) => r.criterionKey === 'training_completion')!;
  assert.equal(req.minimumProvenanceLevel, 'SYSTEM_DERIVED');
  assert.equal(req.mode, 'REQUIRED');
  assert.ok(req.blocksVerifiedScore);
});

// ── Affiliate: lighter provenance bar ────────────────────────────────────────

test('affiliate: all requirements are non-blocking (no financial thresholds)', () => {
  const profile = resolvePlatformEvidenceRequirements('evidence:affiliate:standard:v1')!;
  for (const req of profile.requirements) {
    assert.ok(!req.blocksVerifiedScore, `${req.criterionKey} should not block verified score`);
  }
});

// ── Resolvers ─────────────────────────────────────────────────────────────────

test('resolvePlatformQualificationCriteria: returns undefined for unknown key', () => {
  assert.equal(resolvePlatformQualificationCriteria('qualification:unknown:key:v1'), undefined);
});

test('resolvePlatformEvidenceRequirements: returns undefined for unknown key', () => {
  assert.equal(resolvePlatformEvidenceRequirements('evidence:unknown:key:v1'), undefined);
});

test('listPlatformQualificationProfiles: returns all 11 profiles', () => {
  assert.equal(listPlatformQualificationProfiles().length, 11);
});

test('listPlatformEvidenceProfiles: returns all 11 profiles', () => {
  assert.equal(listPlatformEvidenceProfiles().length, 11);
});

// ── Qualification criteria match evidence requirements ────────────────────────

test('franchise unit: all evidence criterionKeys are present in the qualification profile', () => {
  const qualProfile = resolvePlatformQualificationCriteria('qualification:franchise:unit:v1')!;
  const evProfile = resolvePlatformEvidenceRequirements('evidence:franchise:unit:v1')!;
  const qualKeys = new Set(qualProfile.criteria.map((c) => c.criterionKey));
  for (const req of evProfile.requirements) {
    assert.ok(
      qualKeys.has(req.criterionKey),
      `evidence criterionKey ${req.criterionKey} not in qualification profile`,
    );
  }
});

test('franchise master: all evidence criterionKeys are present in the qualification profile', () => {
  const qualProfile = resolvePlatformQualificationCriteria('qualification:franchise:master:v1')!;
  const evProfile = resolvePlatformEvidenceRequirements('evidence:franchise:master:v1')!;
  const qualKeys = new Set(qualProfile.criteria.map((c) => c.criterionKey));
  for (const req of evProfile.requirements) {
    assert.ok(
      qualKeys.has(req.criterionKey),
      `evidence criterionKey ${req.criterionKey} not found in qualification profile`,
    );
  }
});
