import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const profiles = read('../app/api/leads/capture/scoring-profiles/route.ts');
const profileStatus = read('../app/api/leads/capture/scoring-profiles/[id]/status/route.ts');
const templates = read('../app/api/leads/capture/qualification-templates/route.ts');
const templateStatus = read('../app/api/leads/capture/qualification-templates/[id]/status/route.ts');
const qualifications = read('../app/api/leads/capture/[id]/qualifications/route.ts');
const score = read('../app/api/leads/capture/[id]/score/route.ts');
const adapter = read('../lib/demand-capture-scoring.ts');
const bridge = read('../lib/lead-scoring-domain.ts');
const idempotency = read('../../../infra/db/migrations/0130_demand_capture_score_idempotency.sql');

test('scoring configuration writes are module-activated and Brand-governed', () => {
  for (const source of [profiles, profileStatus, templates, templateStatus]) {
    assert.match(source, /lead-management/);
    assert.match(source, /hasBrandGovernanceForOrganization/);
    assert.match(source, /resolveBrandContext\(\)/);
    assert.match(source, /withBrandTransaction/);
    assert.doesNotMatch(source, /body\.tenantId/);
    assert.doesNotMatch(source, /body\.organizationId/);
  }
  assert.match(profiles, /'DRAFT'/);
  assert.match(profileStatus, /SCORING_PROFILE_ACTIVE_CONFLICT/);
  assert.match(profileStatus, /code\?: string.*23505/s);
  assert.match(profileStatus, /Retired scoring profiles cannot be reactivated/);
  assert.match(templateStatus, /QUALIFICATION_TEMPLATE_ACTIVE_CONFLICT/);
  assert.match(templateStatus, /code\?: string.*23505/s);
  assert.match(templateStatus, /Retired qualification templates cannot be reactivated/);
});

test('qualification evidence is template-bound and server stamps authority', () => {
  assert.match(qualifications, /status='ACTIVE'/);
  assert.match(qualifications, /template\.qualification_template_id/);
  assert.match(qualifications, /template\.version/);
  assert.match(qualifications, /context\.subjectId/);
  assert.match(qualifications, /allowedCriteria/);
  assert.match(qualifications, /hasTemplateKey/);
  assert.match(qualifications, /templateKey must be a non-empty string/);
  assert.match(qualifications, /Unable to record qualification assessments/);
  assert.doesNotMatch(qualifications, /body\.assessedBy/);
  assert.doesNotMatch(qualifications, /body\.organizationId/);
});

test('score recalculation rejects client authority and delegates to one shared deterministic scorer', () => {
  assert.match(score, /SCORING_AUTHORITY_FIELD_REJECTED/);
  for (const field of ['totalScore','band','components','calculationFingerprint','organizationId','tenantId','actorSubjectId']) {
    assert.match(score, new RegExp(field));
  }
  assert.match(score, /calculateAndPersistDemandCaptureScore/);
  assert.match(adapter, /calculateLeadScore/);
  assert.match(adapter, /validateLeadScoringProfileDefinition/);
  assert.match(adapter, /DISTINCT ON \(criterion_key\)/);
  assert.match(adapter, /FOR UPDATE/);
  assert.match(adapter, /createHash\('sha256'\)/);
  assert.match(adapter, /ON CONFLICT/);
  assert.match(bridge, /packages\/lead\/src\/scoring\.ts/);
});

test('score read and write share a stable camelCase numeric contract', () => {
  assert.match(score, /function toScoreResponse/);
  assert.match(score, /scoreId: row\.score_id/);
  assert.match(score, /totalScore: Number\(row\.total_score\)/);
  assert.match(score, /calculationFingerprint: row\.calculation_fingerprint/);
  assert.match(score, /history = scores\.rows\.map\(toScoreResponse\)/);
});

test('score snapshot idempotency is server-derived and database enforced', () => {
  assert.match(idempotency, /calculation_fingerprint/);
  assert.match(idempotency, /CREATE UNIQUE INDEX lead_scores_calculation_fingerprint_uq/);
  assert.match(idempotency, /never supplied as client authority/);
  assert.doesNotMatch(score, /body\.calculationFingerprint/);
});
