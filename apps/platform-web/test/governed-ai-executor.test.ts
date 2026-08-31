import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../lib/governed-ai-executor.ts', import.meta.url),
  'utf8',
);

test('governed AI runtime composes routing, audited credential leasing, artifacts, and attempts', () => {
  assert.match(source, /PostgresProviderRegistryRepository/);
  assert.match(source, /PostgresConnectorCredentialRepository/);
  assert.match(source, /createGovernedCredentialLeaseRuntime/);
  assert.match(source, /governedApiTokenProvider/);
  assert.match(source, /PostgresIndexedDurableArtifactSink/);
  assert.match(source, /OpenAiAiAdapter/);
  assert.match(source, /GeminiAiAdapter/);
  assert.match(source, /RoutedAiGateway/);
  assert.match(source, /actionIntentId:\s*input\.intent\.actionIntentId/);
  assert.match(source, /persistGovernedActionExecutionAttempt/);
});

test('governed AI runtime remains an explicit executor boundary, not an autonomous route', () => {
  assert.match(source, /executePersistedGovernedAiAction/);
  assert.doesNotMatch(source, /NextResponse|export async function POST|export async function GET/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});
