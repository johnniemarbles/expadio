import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runner = readFileSync(new URL('../lib/domain-event-action-runner.ts', import.meta.url), 'utf8');

test('domain event runner is bounded and scheduler neutral', () => {
  assert.match(runner, /runDomainEventActionWorkerBatch/);
  assert.match(runner, /readonly limit: number/);
  assert.match(runner, /for \(let index = 0; index < limit; index \+= 1\)/);
  assert.match(runner, /if \(result\.status === 'IDLE'\) break/);
  assert.match(runner, /requestedLimit/);
  assert.match(runner, /published/);
  assert.match(runner, /failed/);
  assert.match(runner, /dead/);
  assert.match(runner, /staleClaim/);
});

test('runner rejects invalid limits before processing', () => {
  assert.match(runner, /throw new Error\(`\$\{field\}_MUST_BE_POSITIVE_INTEGER`\)/);
  assert.match(runner, /positiveInteger\(input\.limit, 'DOMAIN_EVENT_ACTION_RUNNER_LIMIT'\)/);
});
