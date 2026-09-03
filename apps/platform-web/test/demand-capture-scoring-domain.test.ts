import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateLeadScore,
  LeadScoringValidationError,
  validateLeadScoringProfileDefinition,
} from '@expadio/lead';

const profile = {
  components: [
    {
      key: 'fit',
      criterionKey: 'fit',
      weight: 1,
      pointsPossible: 60,
      responsePoints: {
        MEETS: 60,
        PARTIALLY_MEETS: 30,
        DOES_NOT_MEET: 0,
        NOT_APPLICABLE: 0,
        NOT_ASSESSED: 0,
      },
    },
    {
      key: 'readiness',
      criterionKey: 'readiness',
      weight: 2,
      pointsPossible: 20,
      responsePoints: {
        MEETS: 20,
        PARTIALLY_MEETS: 10,
        DOES_NOT_MEET: 0,
      },
    },
  ],
  bandThresholds: { HOT: 80, WARM: 40, COLD: 0 },
} as const;

test('Demand Capture score is derived deterministically from qualification assessments', () => {
  const result = calculateLeadScore(profile, [
    { criterionKey: 'fit', response: 'MEETS' },
    { criterionKey: 'readiness', response: 'PARTIALLY_MEETS' },
  ]);
  assert.equal(result.totalScore, 80);
  assert.equal(result.band, 'HOT');
  assert.deepEqual(result.components.map((component) => component.pointsAwarded), [60, 20]);
  assert.deepEqual(result.components.map((component) => component.pointsPossible), [60, 40]);
});

test('missing assessments score zero and remain explicit evidence', () => {
  const result = calculateLeadScore(profile, [{ criterionKey: 'fit', response: 'PARTIALLY_MEETS' }]);
  assert.equal(result.totalScore, 30);
  assert.equal(result.band, 'COLD');
  assert.equal(result.components[1]?.rawValue, null);
  assert.match(result.components[1]?.explanation ?? '', /No assessment exists/);
});

test('later assessment snapshot wins for the same criterion', () => {
  const result = calculateLeadScore(profile, [
    { criterionKey: 'fit', response: 'DOES_NOT_MEET' },
    { criterionKey: 'fit', response: 'MEETS' },
    { criterionKey: 'readiness', response: 'MEETS' },
  ]);
  assert.equal(result.totalScore, 100);
  assert.equal(result.band, 'HOT');
});

test('score arithmetic is canonicalized to PostgreSQL numeric(12,4) precision before banding', () => {
  const result = calculateLeadScore({
    components: [{
      key: 'fractional',
      criterionKey: 'fractional',
      weight: 1,
      pointsPossible: 1,
      responsePoints: { MEETS: 0.33333 },
    }],
    bandThresholds: { MATCHED: 0.3333, ZERO: 0 },
  }, [{ criterionKey: 'fractional', response: 'MEETS' }]);
  assert.equal(result.totalScore, 0.3333);
  assert.equal(result.components[0]?.pointsAwarded, 0.3333);
  assert.equal(result.band, 'MATCHED');
});

test('invalid scoring profiles fail closed before persistence', () => {
  assert.throws(
    () => validateLeadScoringProfileDefinition({
      components: [
        { key: 'dup', criterionKey: 'a', weight: 1, pointsPossible: 10, responsePoints: { MEETS: 10 } },
        { key: 'dup', criterionKey: 'b', weight: 1, pointsPossible: 10, responsePoints: { MEETS: 10 } },
      ],
      bandThresholds: { COLD: 0 },
    }),
    (error: unknown) => error instanceof LeadScoringValidationError
      && error.code === 'LEAD_SCORING_COMPONENT_DUPLICATE',
  );

  assert.throws(
    () => validateLeadScoringProfileDefinition({
      components: [
        { key: 'fit', criterionKey: 'fit', weight: 1, pointsPossible: 10, responsePoints: { MEETS: 20 } },
      ],
      bandThresholds: { COLD: 0 },
    }),
    (error: unknown) => error instanceof LeadScoringValidationError
      && error.code === 'LEAD_SCORING_POINTS_RANGE_INVALID',
  );

  assert.throws(
    () => validateLeadScoringProfileDefinition({
      components: [
        { key: 'fit', criterionKey: 'fit', weight: 1, pointsPossible: 10, responsePoints: { MEETS: 10 } },
      ],
      bandThresholds: { HOT: 8, WARM: 4 },
    }),
    (error: unknown) => error instanceof LeadScoringValidationError
      && error.code === 'LEAD_SCORING_ZERO_BAND_REQUIRED',
  );
});
