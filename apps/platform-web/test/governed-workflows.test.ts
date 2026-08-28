import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const lib = read('../lib/governance-instances.ts');
const route = read('../app/api/governance/workflows/route.ts');
const client = read('../app/(shell)/governance/workflows/WorkflowsClient.tsx');
const nav = read('../app/api/workspaces/route.ts');

test('the in-flight read returns open instances by default, tenant-scoped', () => {
  assert.match(lib, /FROM platform\.workflow_instances/);
  assert.match(lib, /state NOT IN \('COMPLETED','CANCELLED','FAILED'\)/);
  assert.match(lib, /work_type_key = \$1/);
  assert.match(lib, /ORDER BY updated_at DESC/);
});

test('the governed-workflows route is a membership read behind RLS', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /resolveRequestContext\(request\)/);
  assert.match(route, /loadTenantInstances/);
});

test('the oversight surface lists and filters in-flight work', () => {
  assert.match(client, /In-flight work/);
  assert.match(client, /All work types/);
  assert.match(nav, /href: '\/governance\/workflows'/);
});
