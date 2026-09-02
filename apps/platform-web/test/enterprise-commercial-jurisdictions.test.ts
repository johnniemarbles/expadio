import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const read=(relative:string)=>fs.readFileSync(path.resolve(here,relative),'utf8');
const migration=read('../../../infra/db/migrations/0112_enterprise_commercial_jurisdictions.sql');
const runtime=read('../lib/enterprise-commercial.ts');
const route=read('../app/api/enterprise/commercial/route.ts');
const page=read('../app/(shell)/organizations/page.tsx');
const hub=read('../app/(shell)/organizations/CommercialNetwork.tsx');

test('enterprise commercial authority is distinct from CRM customer agreements',()=>{
  assert.match(migration,/CREATE TABLE platform\.enterprise_commercial_agreements/);
  assert.doesNotMatch(migration,/REFERENCES platform\.crm_agreements/);
  assert.doesNotMatch(runtime,/platform\.crm_agreements/);
  assert.match(migration,/source_agreement_id IS DISTINCT FROM\s+NEW\.enterprise_commercial_agreement_id::text/);
});

test('territory, appointment and jurisdiction tables are tenant and enterprise constrained',()=>{
  for(const table of ['enterprise_territories','enterprise_commercial_agreements','enterprise_appointments','enterprise_appointment_territories','enterprise_jurisdiction_activations']){
    assert.match(migration,new RegExp(`ALTER TABLE platform\\\\.${table} FORCE ROW LEVEL SECURITY`));
    assert.match(migration,new RegExp(`CREATE POLICY ${table.replace('enterprise_','enterprise_')}.*tenant`, 's'));
  }
  assert.match(migration,/enterprise_territories_reject_cycle/);
  assert.match(migration,/enterprise_appointment_territories_scope_idx/);
  assert.match(migration,/enterprise_jurisdiction_active_org_territory_uq/);
});

test('commercial appointment runs the generic Decision Fabric before rights issuance',()=>{
  assert.match(migration,/'enterprise\.commercial-appointment'/);
  assert.match(migration,/"stageKey": "COMMERCIAL_REVIEW"/);
  assert.match(migration,/"decisionRequired": true/);
  assert.match(runtime,/startWorkflow/);
  assert.match(runtime,/recordCaseDecision/);
  assert.match(runtime,/RepositoryWorkflowRightsGrantService/);
  assert.match(runtime,/PostgresWorkflowRightsGrantRepository/);
  assert.match(runtime,/sourceAgreementId: appointment\.enterprise_commercial_agreement_id/);
});

test('approval, rights and permission-to-operate are separate gates',()=>{
  assert.match(migration,/appointment activation requires matching effective workflow rights/);
  assert.match(migration,/jurisdiction activation requires active matching appointment/);
  assert.match(migration,/jurisdiction activation requires matching workflow activation/);
  assert.match(migration,/jurisdiction activation requires verified activation evidence/);
  assert.match(runtime,/RepositoryWorkflowActivationService/);
  assert.match(runtime,/RepositoryWorkflowActivationVerificationService/);
  assert.match(runtime,/verified\.verification\.state !== 'VERIFIED'/);
});

test('enterprise commercial API is hierarchy-scoped and organization-governed',()=>{
  assert.match(route,/membershipRepository\.listActiveMemberships/);
  assert.match(route,/organization_id = ANY\(\$3::uuid\[\]\)/);
  assert.match(route,/hasGovernanceWriteRoleForOrganization/);
  assert.doesNotMatch(route,/hasPlatformAdministrationRole/);
  assert.match(route,/CREATE_TERRITORY/);
  assert.match(route,/CREATE_APPOINTMENT/);
  assert.match(route,/ISSUE_APPOINTMENT_RIGHTS/);
  assert.match(route,/VERIFY_AND_ACTIVATE_JURISDICTION/);
});

test('Organizations workspace exposes a real Enterprise Hub commercial surface',()=>{
  assert.match(page,/CommercialNetwork/);
  assert.match(page,/\/api\/enterprise\/commercial/);
  assert.match(page,/Commercial network &amp; jurisdictions/);
  assert.match(hub,/Create draft/);
  assert.match(hub,/Move to review/);
  assert.match(hub,/Issue rights/);
  assert.match(hub,/Verify controls & activate/);
  assert.match(hub,/window\.prompt\('Enter the executed-agreement evidence reference\.'/);
  assert.match(hub,/window\.confirm\('Confirm all five activation controls are satisfied/);
  assert.doesNotMatch(hub,/ui:agreement:/);
  assert.doesNotMatch(hub,/ui:jurisdiction:/);
  assert.match(hub,/Separate from CRM\/customer agreements/);
});
