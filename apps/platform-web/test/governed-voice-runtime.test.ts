import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../lib/governed-voice-runtime.ts', import.meta.url),
  'utf8',
);

test('governed Voice runtime composes routing, credential leasing, resolution, and indexed artifacts', () => {
  assert.match(source, /PostgresProviderRegistryRepository/);
  assert.match(source, /PostgresConnectorCredentialRepository/);
  assert.match(source, /createGovernedCredentialLeaseRuntime/);
  assert.match(source, /governedApiTokenProvider/);
  assert.match(source, /PostgresIndexedDurableArtifactSink/);
  assert.match(source, /DeepgramSttAdapter/);
  assert.match(source, /ElevenLabsTtsAdapter/);
  assert.match(source, /RoutedVoiceGateway/);
});

test('governed Voice runtime does not claim telephony or agent orchestration', () => {
  assert.match(source, /invokeGovernedVoiceIntelligence/);
  assert.doesNotMatch(source, /NextResponse|export async function POST|export async function GET/);
  assert.doesNotMatch(source, /Twilio|call control|setInterval/);
});
