import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const route = read('../app/api/authority/grants/route.ts');
const client = read('../app/(shell)/authority/AuthorityClient.tsx');
const page = read('../app/(shell)/authority/page.tsx');
const nav = read('../app/api/workspaces/route.ts');

test('the authority grants route lists and records grants, governed', () => {
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /resolveAuthorityGrants/);
  assert.match(route, /grantAuthority/);
  assert.match(route, /hasCrmWriteRole/);
});

test('the Approval Authority surface can grant and inspect authority', () => {
  assert.match(client, /Grant authority/);
  assert.match(client, /monetary\.approval/);
  // Grants a ceiling and looks a subject's grants up through the governed route.
  assert.match(client, /thresholdMinorUnits/);
  assert.match(client, /\/api\/authority\/grants/);
  assert.match(page, /Approval Authority/);
  assert.match(nav, /href: '\/authority'/);
});

test('a workflow authority denial links to the Approval Authority page', () => {
  const expenses = read('../app/(shell)/expenses/ExpensesClient.tsx');
  const vendors = read('../app/(shell)/vendors/VendorsClient.tsx');
  for (const client of [expenses, vendors]) {
    assert.match(client, /WORKFLOW_AUTHORITY/);
    assert.match(client, /Grant approval authority/);
    assert.match(client, /href=\{`\/authority/);
  }
});
