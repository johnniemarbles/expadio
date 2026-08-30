import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(process.cwd(), '../..');
const freezeDoc = readFileSync(resolve(repoRoot, 'docs/platform/FOUNDATION_FREEZE.md'), 'utf8');
const checklist = readFileSync(resolve(repoRoot, 'docs/platform/PLATFORM_COMPLETION_CHECKLIST.md'), 'utf8');

test('platform foundation freeze protects canonical execution primitives', () => {
  for (const required of [
    'Domain Event Fabric',
    'transactional outbox',
    'Governed Action Fabric',
    '`COMMUNICATE` executor',
    '`SCHEDULE` executor',
    '`CREATE_TASK` executor',
    'verified provider webhook ingestion',
    'business execution trace read model',
    'execution trace API',
  ]) {
    assert.match(freezeDoc, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('platform freeze forbids duplicate core engines and vertical forks', () => {
  for (const required of [
    'No duplicate core engines',
    'No vertical forks of horizontal capabilities',
    'No direct AI or agent mutation',
    'No implicit demo fallbacks in production code',
    'Recovery must be governed',
  ]) {
    assert.match(freezeDoc, new RegExp(required));
  }
});

test('platform completion checklist records current strategic lock', () => {
  for (const required of [
    '- [x] Pause DENTEX clinical/product-depth work until full platform capability is broader.',
    '- [x] Pause additional vertical implementation until platform completion program reaches the AI/knowledge/agent/voice foundation stage.',
    '- [x] Treat the horizontal execution foundation as frozen except for targeted hardening and capability completion.',
    '- [x] Use the repository, not chat memory, as the durable checklist of completed work.',
  ]) {
    assert.ok(checklist.includes(required), `missing checklist lock: ${required}`);
  }
});

test('platform completion checklist preserves next P0 work', () => {
  for (const required of [
    'Define explicit communication delivery state transition matrix',
    'Add tests for out-of-order lifecycle events',
    'Add execution health read model',
    'Add governed recovery command model',
    'Remove obsolete Communications `route.ts.tmp` artifact if still present.',
  ]) {
    assert.ok(checklist.includes(required), `missing P0 checklist item: ${required}`);
  }
});
