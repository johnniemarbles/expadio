import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const dashboard = read('../app/(shell)/platform-health/PlatformHealthDashboard.tsx');
const page = read('../app/(shell)/platform-health/page.tsx');
const css = read('../app/(shell)/platform-health/telemetry.module.css');
const workspaces = read('../app/api/workspaces/route.ts');
const landing = read('../app/(shell)/page.tsx');
const overview = read('../app/(shell)/overview/page.tsx');

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
  assert.match(dashboard, /Telemetry Command Center/);
});

test('telemetry command center is discoverable and uses honest live signals', () => {
  assert.match(workspaces, /label: 'Command Center'.*href: '\/'/);
  assert.match(workspaces, /label: 'Fleet Overview'.*href: '\/overview'/);
  assert.match(landing, /platform-health\/page/);
  assert.match(overview, /BusinessOverviewPage/);
  assert.match(overview, /liveWorkspaceAdapter\.loadOverview/);
  assert.match(dashboard, /POLL_INTERVAL_MS = 30_000/);
  assert.match(dashboard, /performance\.now\(\)/);
  assert.match(dashboard, /All governed health APIs currently report a clear snapshot/);
  assert.doesNotMatch(dashboard, /CPU|Memory|Throughput/);
});

test('telemetry visual language includes motion with reduced-motion safety', () => {
  for (const token of ['#09090b', '#121215', '#27272a', '#06b6d4', '#8b5cf6', '#f59e0b']) {
    assert.match(css, new RegExp(token));
  }
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /--spot-x/);
  assert.match(dashboard, /aria-live="polite"/);
  assert.match(dashboard, /aria-modal="true"/);
});
