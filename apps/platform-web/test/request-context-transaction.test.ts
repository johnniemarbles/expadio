import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../lib/request-context.ts', import.meta.url),
  'utf8',
);

test('tenant transaction helper binds local RLS context inside an explicit transaction', () => {
  const start = source.indexOf('export async function withTenantTransaction');
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf('/** §3.4', start));

  const begin = body.indexOf("client.query('BEGIN')");
  const apply = body.indexOf('context.applyTo(client)');
  const work = body.indexOf('await work(client)');
  const commit = body.indexOf("client.query('COMMIT')");

  assert.ok(begin >= 0 && apply > begin && work > apply && commit > work);
  assert.match(body, /client\.query\('ROLLBACK'\)/);
  assert.match(body, /client\.release\(\)/);
});
