import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../app/(shell)/dentex/page.tsx');
const client = read('../app/(shell)/dentex/DentexOperationsClient.tsx');

test('DENTEX operations composes Patient and Practice from canonical CRM authorities', () => {
  assert.match(page, /fetchApi<CrmAccount\[\]>\('\/api\/crm\/accounts'\)/);
  assert.match(page, /fetchApi<PatientRow\[\]>\('\/api\/crm\/contacts'\)/);
  assert.doesNotMatch(page, /api\/dentex\/patients/);
  assert.doesNotMatch(page, /api\/dentex\/practices/);
  assert.match(client, /fetch\('\/api\/crm\/contacts'/);
  assert.match(client, /fetch\('\/api\/crm\/accounts'/);
  assert.match(client, /title: 'Patient'/);
  assert.match(client, /industry: 'Dental'/);
  assert.match(client, /lifecycleStage: 'CUSTOMER'/);
});

test('DENTEX operations exposes usable Patient and Practice workflows', () => {
  assert.match(client, /Patient & Practice Operations/);
  assert.match(client, /Create Patient/);
  assert.match(client, /Create Practice/);
  assert.match(client, /Patients linked to Practice/);
  assert.match(client, /Unlinked Patients/);
  assert.match(client, /Open CRM engine/);
});
