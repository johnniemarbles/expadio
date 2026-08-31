import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAND_JOURNEY_STEPS,
  assertJourneyIsObservationOnly,
  assertPlatformPayloadHasNoCustomerPii,
  emptyBrandJourneyObservation,
  platformViewOfJourney,
} from '../src/index.ts';

test('CS-104 observation starts empty on frozen executors', () => {
  const observation = emptyBrandJourneyObservation('CS-104', 'CS-104');
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
  const observation = emptyBrandJourneyObservation('CS-104', 'CS-104');
  const view = platformViewOfJourney(observation);
  assert.equal(view.correlation, 'CS-104');
  assert.equal(view.caseId, 'CS-104');
  assertPlatformPayloadHasNoCustomerPii(view);
  assert.throws(
    () => assertJourneyIsObservationOnly({ ...observation, mutationsEnabled: true as unknown as false }),
    /BRAND_JOURNEY_MUTATION_FORBIDDEN/,
  );
});
