import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const dashboard = read('../app/(shell)/platform-health/PlatformHealthDashboard.tsx');
const page = read('../app/(shell)/platform-health/page.tsx');

test('platform health dashboard consumes only governed health APIs', () => {
  for (const endpoint of [
    '/api/execution/health',
    '/api/communications/health',
    '/api/scheduler/health',
    '/api/outbox/health',
  ]) {
    assert.match(dashboard, new RegExp(endpoint.replaceAll('/', '\\/')));
  }

  assert.doesNotMatch(dashboard, /platform\.execution_health_summary/);
  assert.doesNotMatch(dashboard, /platform\.communication_health_summary/);
  assert.doesNotMatch(dashboard, /platform\.scheduler_health_summary/);
  assert.doesNotMatch(dashboard, /platform\.outbox_health_summary/);
});

test('platform health dashboard is read-only and does not expose recovery commands', () => {
  assert.match(dashboard, /fetch\(appendQuery\(domain\.endpoint, queryString\), \{ cache: "no-store" \}\)/);
  assert.doesNotMatch(dashboard, /method:\s*["']POST["']/);
  assert.doesNotMatch(dashboard, /method:\s*["']PATCH["']/);
  assert.doesNotMatch(dashboard, /method:\s*["']DELETE["']/);
  assert.doesNotMatch(dashboard, /export async function POST/);
  assert.doesNotMatch(dashboard, /retry command/i);
  assert.doesNotMatch(dashboard, /cancel command/i);
  assert.doesNotMatch(dashboard, /mark-resolved/i);
});

test('platform health page preserves workspace query context', () => {
  assert.match(page, /PlatformHealthDashboard/);
  assert.match(page, /params\.account/);
  assert.match(page, /params\.org/);
  assert.match(page, /queryString=\{q\}/);
  assert.match(page, /Platform health dashboard/);
});
