import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = new URL('../../..', import.meta.url);
const repositorySource = readFileSync(join(repoRoot.pathname, 'verticals/dentex/src/repository.ts'), 'utf8');

test('DENTEX repository contracts require tenant and audit write context', () => {
  assert.match(repositorySource, /export interface DentexWriteContext extends DentexTenantContext/u);
  assert.match(repositorySource, /audit: DentexAuditContext/u);
  assert.match(repositorySource, /withTenantTransaction/u);
});

test('DENTEX repository ports cover the clinical aggregate roots', () => {
  for (const repository of [
    'DentexPatientRepository',
    'DentexPracticeRepository',
    'DentexProviderRepository',
    'DentexReferralRepository',
    'DentexCarePlanRepository',
    'DentexTreatmentRepository',
    'DentexDomainEventRepository',
  ]) {
    assert.match(repositorySource, new RegExp(`export interface ${repository}`, 'u'));
  }
});

test('DENTEX repository contracts do not introduce runtime execution concerns', () => {
  const forbidden = [
    /\bSCHEDULE\b/u,
    /\bCREATE_TASK\b/u,
    /COMMUNICATE/u,
    /provider adapter/iu,
    /dbPool/u,
    /PoolClient/u,
    /SELECT\s+/iu,
    /INSERT\s+/iu,
    /UPDATE\s+/iu,
    /DELETE\s+/iu,
  ];

  for (const pattern of forbidden) {
    assert.doesNotMatch(repositorySource, pattern);
  }
});
