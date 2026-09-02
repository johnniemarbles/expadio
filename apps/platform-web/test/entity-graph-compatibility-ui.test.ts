import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const hub = read('../app/(shell)/enterprise/EnterpriseHub.tsx');
const status = read('../app/(shell)/enterprise/GraphCompatibilityStatus.tsx');

test('Enterprise Hub perspectives surface the real compatibility proof', () => {
  assert.match(hub, /GraphCompatibilityStatus/);
  assert.match(hub, /<GraphCompatibilityStatus suffix=\{suffix\} \/>/);
  assert.match(status, /\/api\/enterprise\/graph\/compatibility/);
  assert.match(status, /cache: 'no-store'/);
});

test('compatibility status is read-only and preserves platform rollout ownership', () => {
  assert.match(status, /Brands can inspect this proof but cannot change the rollout switch/);
  assert.match(status, /Platform operations/);
  assert.doesNotMatch(status, /method: ['"]POST['"]/);
  assert.doesNotMatch(status, /method: ['"]PATCH['"]/);
});

test('compatibility status renders loading, failure, drift and rollback states', () => {
  assert.match(status, /kind: 'loading'/);
  assert.match(status, /kind: 'error'/);
  assert.match(status, /driftFree/);
  assert.match(status, /graphReadsEnabled/);
  assert.match(status, /rollbackMode/);
  assert.match(status, /aria-live="polite"/);
});
