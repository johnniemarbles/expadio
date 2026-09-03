import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../infra/db/migrations/0134_communication_certifications.sql');
const setupState = read('../app/api/communications/setup/state/route.ts');

test('Communications LIVE is backed by durable certification evidence', () => {
  assert.match(migration, /CREATE TABLE platform\.communication_certifications/);
  assert.match(migration, /delivery_id uuid NOT NULL/);
  assert.match(migration, /provider_attempt_id uuid NOT NULL/);
  assert.match(migration, /webhook_event_id text NOT NULL/);
  assert.match(migration, /decision_trace_id uuid/);
  assert.match(migration, /status text NOT NULL DEFAULT 'LIVE_CERTIFIED'/);
  assert.match(migration, /communication_certifications_live_connector_uq/);
});

test('setup state does not infer live from enabled connector plus test send', () => {
  assert.match(setupState, /communication_certifications/);
  assert.match(setupState, /LIVE_CERTIFIED/);
  assert.match(setupState, /READY_FOR_CERTIFICATION/);
  assert.match(setupState, /This does not certify LIVE delivery/);
  assert.match(setupState, /durable dispatch, provider attempt, signed webhook, terminal delivery, and trace evidence/);
  assert.doesNotMatch(setupState, /isLive:\s*facts\.enabled\s*>\s*0\s*&&\s*facts\.testSends\s*>\s*0/);
  assert.doesNotMatch(setupState, /complete:\s*facts\.enabled\s*>\s*0\s*&&\s*facts\.testSends\s*>\s*0/);
});
