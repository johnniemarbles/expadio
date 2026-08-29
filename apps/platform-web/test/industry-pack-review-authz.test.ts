import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const submitRoute = readFileSync(
  new URL('../app/api/configuration/industry-packs/drafts/[verticalKey]/[version]/submit/route.ts', import.meta.url),
  'utf8',
);
const returnRoute = readFileSync(
  new URL('../app/api/configuration/industry-packs/reviews/[verticalKey]/[version]/return/route.ts', import.meta.url),
  'utf8',
);

for (const [name, route] of [['submit', submitRoute], ['return', returnRoute]] as const) {
  test(`Industry Pack ${name} review mutation requires a governing role before repository access`, () => {
    const transactionIndex = route.indexOf('withTenantTransaction(context');
    const authzIndex = route.indexOf('hasGovernanceWriteRole(client, context.subjectId)', transactionIndex);
    const repositoryIndex = route.indexOf('PostgresIndustryPackVersionRepository(client)', transactionIndex);
    assert.ok(transactionIndex >= 0);
    assert.ok(authzIndex > transactionIndex);
    assert.ok(repositoryIndex > authzIndex);
    assert.match(route, /kind: 'FORBIDDEN'/);
    assert.match(route, /reasonKey: 'FORBIDDEN'/);
    assert.match(route, /status: 403/);
  });
}
