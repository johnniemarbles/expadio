import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const createRoute = readFileSync(
  new URL('../app/api/configuration/industry-packs/drafts/route.ts', import.meta.url),
  'utf8',
);
const updateRoute = readFileSync(
  new URL('../app/api/configuration/industry-packs/drafts/[verticalKey]/[version]/route.ts', import.meta.url),
  'utf8',
);

for (const [name, route] of [['create', createRoute], ['update', updateRoute]] as const) {
  test(`Industry Pack ${name} draft mutation requires a governing role inside tenant transaction`, () => {
    assert.match(route, /hasGovernanceWriteRole/);
    const transactionIndex = route.indexOf('withTenantTransaction(context');
    const authzIndex = route.indexOf('hasGovernanceWriteRole(client, context.subjectId)', transactionIndex);
    const repositoryIndex = route.indexOf('PostgresIndustryPackVersionRepository(client)', transactionIndex);
    assert.ok(transactionIndex >= 0);
    assert.ok(authzIndex > transactionIndex);
    assert.ok(repositoryIndex > authzIndex);
    assert.match(route, /reasonKey: 'FORBIDDEN'/);
    assert.match(route, /status: 403/);
  });
}
