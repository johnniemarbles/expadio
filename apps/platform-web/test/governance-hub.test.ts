import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const dir = read('../app/(shell)/governance/GovernanceToolsDirectory.tsx');
const page = read('../app/(shell)/governance/page.tsx');

test('the governance hub links to every oversight tool', () => {
  for (const href of [
    '/governance/queue',
    '/governance/pending',
    '/governance/workflows',
    '/governance/decisions',
    '/governance/analytics',
    '/governance/authorization',
  ]) {
    assert.ok(dir.includes(`'${href}'`), `directory links to ${href}`);
  }
});

test('the Governance Center renders the tools directory under the KPI strip', () => {
  assert.match(page, /GovernanceSummaryStrip/);
  assert.match(page, /GovernanceToolsDirectory/);
});
