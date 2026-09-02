import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../app/api/communications/setup/state/route.ts', import.meta.url), 'utf8');

test('Communications setup state never fabricates zero facts on query failure', () => {
  assert.doesNotMatch(route, /\.catch\(\(\) => \(\{ rows:/);
  assert.match(route, /communication_sending_domains/);
  assert.match(route, /communication_sender_identities/);
  assert.match(route, /communication_plane_budgets/);
  assert.match(route, /communication_spend_caps/);
  assert.match(route, /communication_decision_traces/);
});

test('setup state query failures propagate through the structured denied boundary', () => {
  assert.match(route, /catch \(error\)/);
  assert.match(route, /deniedResponse\(error\)/);
  assert.match(route, /return NextResponse\.json\(body, \{ status \}\)/);
});
