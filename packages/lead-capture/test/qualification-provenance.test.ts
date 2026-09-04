import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildQualificationFact,
  QUALIFICATION_EVIDENCE_SOURCES,
  QualificationProvenanceError,
  validateEvidenceSource,
} from '../src/qualification-provenance.ts';

// ── Catalog ───────────────────────────────────────────────────────────────────

test('QUALIFICATION_EVIDENCE_SOURCES contains all 5 ADR-017 values', () => {
  const expected = [
    'SELF_DECLARED',
    'SYSTEM_DERIVED',
    'OPERATOR_ASSESSED',
    'DOCUMENT_VERIFIED',
    'EXTERNAL_VERIFIED',
  ];
  assert.deepEqual([...QUALIFICATION_EVIDENCE_SOURCES], expected);
});

// ── validateEvidenceSource ────────────────────────────────────────────────────

test('validateEvidenceSource: accepts all valid sources', () => {
  for (const src of QUALIFICATION_EVIDENCE_SOURCES) {
    assert.equal(validateEvidenceSource(src), src);
  }
});

test('validateEvidenceSource: trims whitespace', () => {
  assert.equal(validateEvidenceSource('  SELF_DECLARED  '), 'SELF_DECLARED');
});

test('validateEvidenceSource: throws MISSING_EVIDENCE_SOURCE for null', () => {
  assert.throws(
    () => validateEvidenceSource(null),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'MISSING_EVIDENCE_SOURCE',
  );
});

test('validateEvidenceSource: throws MISSING_EVIDENCE_SOURCE for empty string', () => {
  assert.throws(
    () => validateEvidenceSource(''),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'MISSING_EVIDENCE_SOURCE',
  );
});

test('validateEvidenceSource: throws MISSING_EVIDENCE_SOURCE for blank string', () => {
  assert.throws(
    () => validateEvidenceSource('   '),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'MISSING_EVIDENCE_SOURCE',
  );
});

test('validateEvidenceSource: throws UNKNOWN_EVIDENCE_SOURCE for unrecognised value', () => {
  assert.throws(
    () => validateEvidenceSource('MADE_UP'),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'UNKNOWN_EVIDENCE_SOURCE',
  );
});

// ── buildQualificationFact — happy path ───────────────────────────────────────

const BASE_OPTIONS = {
  qualificationId: 'qual-001',
  captureLeadId: 'lead-001',
  tenantId: 'tenant-001',
  organizationId: 'org-001',
  qualificationTemplateId: 'tmpl-001',
  templateVersion: 1,
  criterionKey: 'min_investment',
  response: 'MEETS' as const,
  evidenceSource: 'OPERATOR_ASSESSED',
  note: null,
  assessedBySubjectId: 'user|abc',
  assessedAt: '2026-09-07T10:00:00Z',
};

test('buildQualificationFact: builds valid fact from complete input', () => {
  const fact = buildQualificationFact(BASE_OPTIONS);
  assert.equal(fact.qualificationId, 'qual-001');
  assert.equal(fact.evidenceSource, 'OPERATOR_ASSESSED');
  assert.equal(fact.response, 'MEETS');
  assert.equal(fact.note, null);
});

test('buildQualificationFact: trims whitespace on evidenceSource', () => {
  const fact = buildQualificationFact({ ...BASE_OPTIONS, evidenceSource: '  DOCUMENT_VERIFIED  ' });
  assert.equal(fact.evidenceSource, 'DOCUMENT_VERIFIED');
});

test('buildQualificationFact: note is null when empty string', () => {
  const fact = buildQualificationFact({ ...BASE_OPTIONS, note: '   ' });
  assert.equal(fact.note, null);
});

test('buildQualificationFact: note is preserved when non-blank', () => {
  const fact = buildQualificationFact({ ...BASE_OPTIONS, note: 'Reviewed ID document.' });
  assert.equal(fact.note, 'Reviewed ID document.');
});

test('buildQualificationFact: SELF_DECLARED accepted for form submissions', () => {
  const fact = buildQualificationFact({ ...BASE_OPTIONS, evidenceSource: 'SELF_DECLARED' });
  assert.equal(fact.evidenceSource, 'SELF_DECLARED');
});

test('buildQualificationFact: SYSTEM_DERIVED accepted for engine-computed facts', () => {
  const fact = buildQualificationFact({ ...BASE_OPTIONS, evidenceSource: 'SYSTEM_DERIVED' });
  assert.equal(fact.evidenceSource, 'SYSTEM_DERIVED');
});

test('buildQualificationFact: EXTERNAL_VERIFIED accepted for third-party checks', () => {
  const fact = buildQualificationFact({ ...BASE_OPTIONS, evidenceSource: 'EXTERNAL_VERIFIED' });
  assert.equal(fact.evidenceSource, 'EXTERNAL_VERIFIED');
});

// ── ADR-017 Invariant 3 enforcement ──────────────────────────────────────────

// Invariant 3: no write path may omit evidence_source.
test('ADR-017 Invariant 3: null evidenceSource throws MISSING_EVIDENCE_SOURCE', () => {
  assert.throws(
    () => buildQualificationFact({ ...BASE_OPTIONS, evidenceSource: null }),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'MISSING_EVIDENCE_SOURCE',
  );
});

test('ADR-017 Invariant 3: undefined evidenceSource throws MISSING_EVIDENCE_SOURCE', () => {
  assert.throws(
    () => buildQualificationFact({ ...BASE_OPTIONS, evidenceSource: undefined }),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'MISSING_EVIDENCE_SOURCE',
  );
});

test('ADR-017 Invariant 3: empty string evidenceSource throws MISSING_EVIDENCE_SOURCE', () => {
  assert.throws(
    () => buildQualificationFact({ ...BASE_OPTIONS, evidenceSource: '' }),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'MISSING_EVIDENCE_SOURCE',
  );
});

test('ADR-017 Invariant 3: blank-whitespace evidenceSource throws MISSING_EVIDENCE_SOURCE', () => {
  assert.throws(
    () => buildQualificationFact({ ...BASE_OPTIONS, evidenceSource: '   ' }),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'MISSING_EVIDENCE_SOURCE',
  );
});

test('ADR-017 Invariant 3: unrecognised evidenceSource throws UNKNOWN_EVIDENCE_SOURCE', () => {
  assert.throws(
    () => buildQualificationFact({ ...BASE_OPTIONS, evidenceSource: 'AI_GENERATED' }),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'UNKNOWN_EVIDENCE_SOURCE',
  );
});

// ── buildQualificationFact — required field validation ───────────────────────

test('buildQualificationFact: throws MISSING_FIELD when qualificationId is blank', () => {
  assert.throws(
    () => buildQualificationFact({ ...BASE_OPTIONS, qualificationId: '' }),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'MISSING_FIELD',
  );
});

test('buildQualificationFact: throws MISSING_FIELD when criterionKey is blank', () => {
  assert.throws(
    () => buildQualificationFact({ ...BASE_OPTIONS, criterionKey: '' }),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'MISSING_FIELD',
  );
});

test('buildQualificationFact: throws INVALID_TEMPLATE_VERSION when templateVersion is 0', () => {
  assert.throws(
    () => buildQualificationFact({ ...BASE_OPTIONS, templateVersion: 0 }),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'INVALID_TEMPLATE_VERSION',
  );
});

test('buildQualificationFact: throws INVALID_TEMPLATE_VERSION when templateVersion is negative', () => {
  assert.throws(
    () => buildQualificationFact({ ...BASE_OPTIONS, templateVersion: -1 }),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'INVALID_TEMPLATE_VERSION',
  );
});

test('buildQualificationFact: throws UNKNOWN_RESPONSE for invalid response', () => {
  assert.throws(
    () => buildQualificationFact({ ...BASE_OPTIONS, response: 'MAYBE' as never }),
    (e: unknown) => e instanceof QualificationProvenanceError && e.code === 'UNKNOWN_RESPONSE',
  );
});

// ── All valid response values ─────────────────────────────────────────────────

test('buildQualificationFact: accepts all valid QualificationResponse values', () => {
  const responses = ['NOT_ASSESSED', 'MEETS', 'PARTIALLY_MEETS', 'DOES_NOT_MEET', 'NOT_APPLICABLE'] as const;
  for (const response of responses) {
    const fact = buildQualificationFact({ ...BASE_OPTIONS, response });
    assert.equal(fact.response, response);
  }
});
