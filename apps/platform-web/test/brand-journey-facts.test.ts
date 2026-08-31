import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FROZEN_EXECUTOR_FACT_QUERY, journeyFactsFromRows } from '../lib/brand-journey-facts.ts';

const runtime = readFileSync(new URL('../lib/brand-host-runtime.ts', import.meta.url), 'utf8');
const platformCorrelation = readFileSync(
  new URL('../app/api/journey-correlation/route.ts', import.meta.url),
  'utf8',
);
const factsLib = readFileSync(new URL('../lib/brand-journey-facts.ts', import.meta.url), 'utf8');

test('Brand journey fact SQL never selects configuration or recipients', () => {
  assert.match(FROZEN_EXECUTOR_FACT_QUERY, /governed_action_intents/);
  assert.match(FROZEN_EXECUTOR_FACT_QUERY, /governed_action_execution_attempts/);
  assert.match(FROZEN_EXECUTOR_FACT_QUERY, /SCHEDULE', 'CREATE_TASK', 'COMMUNICATE/);
  assert.doesNotMatch(FROZEN_EXECUTOR_FACT_QUERY, /configuration/);
  assert.doesNotMatch(FROZEN_EXECUTOR_FACT_QUERY, /metadata/);
  assert.doesNotMatch(FROZEN_EXECUTOR_FACT_QUERY, /email|phone|full_name|recipient/i);
  assert.doesNotMatch(factsLib, /executeGovernedCommunicateAction/);
});

test('Brand journey runtime folds facts after membership; Platform correlation does not query executors', () => {
  assert.match(runtime, /readFrozenExecutorRows/);
  assert.match(runtime, /factsFromFrozenExecutorRows/);
  assert.match(runtime, /observeBrandJourneyFromFacts/);
  assert.doesNotMatch(runtime, /executeGovernedCommunicateAction/);
  assert.doesNotMatch(runtime, /persistGovernedActionIntent/);
  assert.doesNotMatch(platformCorrelation, /governed_action/);
  assert.doesNotMatch(platformCorrelation, /readFrozenExecutorRows/);
});

test('succeeded schedule stays queued', () => {
  const facts = journeyFactsFromRows('CS-104', [
    { correlation: 'CS-104', executor: 'SCHEDULE', attemptStatus: 'SUCCEEDED' },
  ]);
  assert.equal(facts[0]?.state, 'queued');
});
