import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAND_FALLBACK_JOURNEY_ROUTE,
  BRAND_JOURNEY_ROUTE,
  BRAND_JOURNEY_STEPS,
  CS104_CORRELATION,
  PLATFORM_JOURNEY_CORRELATION_ROUTE,
  assertJourneyIsObservationOnly,
  assertPlatformPayloadHasNoCustomerPii,
  emptyBrandJourneyObservation,
  observeBrandJourneyFromFacts,
  parseJourneyCorrelation,
  platformViewOfJourney,
  refuseBrandJourneyWrite,
} from '../src/index.ts';

test('CS-104 observation starts empty on frozen executors', () => {
  const observation = emptyBrandJourneyObservation(CS104_CORRELATION, CS104_CORRELATION);
  assert.equal(observation.mutationsEnabled, false);
  assert.equal(observation.autoSend, false);
  assert.deepEqual(
    observation.steps.map((step) => step.step),
    [...BRAND_JOURNEY_STEPS],
  );
  assert.ok(observation.steps.every((step) => step.state === 'not-observed'));
  assert.equal(observation.steps.find((step) => step.step === 'SCHEDULE')?.executor, 'SCHEDULE');
  assert.equal(observation.steps.find((step) => step.step === 'CREATE_TASK')?.executor, 'CREATE_TASK');
  assert.equal(observation.steps.find((step) => step.step === 'COMMUNICATE')?.executor, 'COMMUNICATE');
  assertJourneyIsObservationOnly(observation);
});

test('Platform may keep the correlation and must drop the customer', () => {
  const observation = emptyBrandJourneyObservation(CS104_CORRELATION, CS104_CORRELATION);
  const view = platformViewOfJourney(observation);
  assert.equal(view.correlation, CS104_CORRELATION);
  assert.equal(view.caseId, CS104_CORRELATION);
  assertPlatformPayloadHasNoCustomerPii(view);
  assert.throws(
    () => assertJourneyIsObservationOnly({ ...observation, mutationsEnabled: true as unknown as false }),
    /BRAND_JOURNEY_MUTATION_FORBIDDEN/,
  );
});

test('writes and invented delivery stay closed', () => {
  refuseBrandJourneyWrite('GET');
  assert.throws(() => refuseBrandJourneyWrite('POST'), /BRAND_JOURNEY_MUTATION_FORBIDDEN/);
  assert.throws(() => parseJourneyCorrelation('patient@clinic.test'), /INVALID_JOURNEY_CORRELATION/);
  assert.throws(
    () =>
      observeBrandJourneyFromFacts(CS104_CORRELATION, CS104_CORRELATION, [
        { correlation: CS104_CORRELATION, executor: 'SCHEDULE', state: 'delivered' },
      ]),
    /JOURNEY_DELIVERY_NOT_INFERRED/,
  );
  assert.throws(
    () =>
      observeBrandJourneyFromFacts(CS104_CORRELATION, CS104_CORRELATION, [
        { correlation: CS104_CORRELATION, executor: 'CREATE_TASK', state: 'sent' },
      ]),
    /JOURNEY_DELIVERY_NOT_INFERRED/,
  );
});

test('COMMUNICATE delivered is the only path that marks delivery', () => {
  const scheduled = observeBrandJourneyFromFacts(CS104_CORRELATION, CS104_CORRELATION, [
    { correlation: CS104_CORRELATION, executor: 'SCHEDULE', state: 'queued' },
    { correlation: CS104_CORRELATION, executor: 'CREATE_TASK', state: 'queued' },
  ]);
  assert.equal(scheduled.steps.find((step) => step.step === 'SCHEDULE')?.state, 'queued');
  assert.equal(scheduled.steps.find((step) => step.step === 'DELIVERY')?.state, 'not-observed');
  const delivered = observeBrandJourneyFromFacts(CS104_CORRELATION, CS104_CORRELATION, [
    { correlation: CS104_CORRELATION, executor: 'COMMUNICATE', state: 'delivered' },
  ]);
  assert.equal(delivered.steps.find((step) => step.step === 'COMMUNICATE')?.state, 'delivered');
  assert.equal(delivered.steps.find((step) => step.step === 'DELIVERY')?.state, 'delivered');
  assert.equal(delivered.mutationsEnabled, false);
  assert.equal(BRAND_JOURNEY_ROUTE, '/api/brand/journey');
  assert.equal(BRAND_FALLBACK_JOURNEY_ROUTE, '/brand/api/journey');
  assert.equal(PLATFORM_JOURNEY_CORRELATION_ROUTE, '/api/journey-correlation');
});
