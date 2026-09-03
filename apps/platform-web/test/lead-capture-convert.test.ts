import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CaptureScopeRejected,
  buildTrustedCaptureConvertWrite,
  captureLeadIdFromConvertBody,
  principalFromResolvedContext,
} from '../lib/lead-capture-convert.ts';
import { LeadValidationError } from '@expadio/lead';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const fromCapture = read('../app/api/crm/leads/from-capture/route.ts');
const customerConvert = read('../app/api/crm/leads/[id]/convert/route.ts');
const writer = read('../lib/lead-capture-convert.ts');
const leadDomain = read('../../../packages/lead/src/index.ts');
const seamMigration = read('../../../infra/db/migrations/0087_lead_capture_convert_seam.sql');
const organizationScopeMigration = read('../../../infra/db/migrations/0123_crm_lead_organization_scope.sql');
const trustedCaptureMigration = read('../../../infra/db/migrations/0125_demand_capture_trusted_seam.sql');

const context = {
  subjectId: 'user_1',
  tenantId: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  platformScope: false,
  applyTo: async () => undefined,
};

test('from-capture is a governed organization write and loads trusted persisted capture state', () => {
  assert.match(fromCapture, /resolveRequestContext\(request\)/);
  assert.match(fromCapture, /ORGANIZATION_CONTEXT_REQUIRED/);
  assert.match(fromCapture, /withTenantTransaction/);
  assert.match(fromCapture, /hasCrmWriteRole/);
  assert.match(fromCapture, /captureLeadIdFromConvertBody/);
  assert.match(fromCapture, /loadTrustedCaptureProjection/);
  assert.match(fromCapture, /buildTrustedCaptureConvertWrite/);
  assert.match(fromCapture, /capturePreserved: true/);
  assert.match(fromCapture, /deleteCapture: false/);
  assert.doesNotMatch(fromCapture, /LAB_TRUSTED_HEADERS/);
});

test('projection request can identify a capture row but cannot assert capture data or scope', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.equal(captureLeadIdFromConvertBody({ captureLeadId: id }), id);
  for (const forged of [
    { captureLeadId: id, tenantId: 'forged' },
    { captureLeadId: id, organizationId: context.organizationId },
    { captureLeadId: id, layerId: 'in' },
    { captureLeadId: id, captureLayerId: 'in-tn-u1' },
    { captureLeadId: id, captureStage: 'WON' },
    { captureLeadId: id, title: 'forged' },
    { captureLeadId: id, email: 'forged@example.test' },
    { captureLeadId: id, rawPayload: { forged: true } },
    { captureLeadId: id, contactId: id },
    { captureLeadId: id, accountId: id },
  ]) assert.throws(() => captureLeadIdFromConvertBody(forged), CaptureScopeRejected);
  assert.throws(() => captureLeadIdFromConvertBody({ captureLeadId: 'nope' }), LeadValidationError);
});

test('trusted capture loader derives organization, stage, payload and layer from persisted tables', () => {
  assert.match(writer, /FROM platform\.lead_capture_leads l/);
  assert.match(writer, /JOIN platform\.lead_capture_sources s/);
  assert.match(writer, /l\.organization_id/);
  assert.match(writer, /l\.stage/);
  assert.match(writer, /l\.raw_payload/);
  assert.match(writer, /s\.layer_key/);
  assert.match(writer, /l\.tenant_id = \$2::uuid/);
});

test('trusted projection maps 19-stage capture to CRM without deleting capture history', () => {
  const projection = {
    organizationId: context.organizationId,
    ownerSubjectId: 'owner_1',
    snapshot: {
      captureLeadId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      tenantId: context.tenantId,
      captureStage: 'APPLICATION_STARTED',
      title: 'Trusted enquiry',
      captureLayerId: 'source-layer-1',
      rawPayload: { persisted: true },
    },
  };
  const write = buildTrustedCaptureConvertWrite(projection, context);
  assert.equal(write.principal.tenantId, context.tenantId);
  assert.equal(write.organizationId, context.organizationId);
  assert.equal(write.ownerSubjectId, 'owner_1');
  assert.equal(write.input.source, 'web_form');
  assert.equal(write.input.stage, 'PROPOSAL');
  assert.equal(write.input.captureLayerId, 'source-layer-1');
  assert.equal(write.deleteCapture, false);
});

test('customer convert funnel stays separate from capture projection', () => {
  assert.match(customerConvert, /Convert a won piece of business into a customer/);
  assert.doesNotMatch(customerConvert, /buildCrmLeadFromCapture/);
  assert.doesNotMatch(customerConvert, /from-capture/);
});

test('capture and CRM catalogues stay separate', () => {
  assert.match(leadDomain, /export function mapCaptureStageToCrm/);
  assert.match(leadDomain, /export function buildCrmLeadFromCapture/);
  assert.match(leadDomain, /DEMAND_CAPTURE_LEAD_SOURCE = 'web_form'/);
  assert.match(seamMigration, /ADD COLUMN IF NOT EXISTS capture_lead_id uuid/);
  assert.match(seamMigration, /crm_leads_tenant_capture_uidx/);
  assert.match(trustedCaptureMigration, /CREATE TABLE platform\.lead_capture_leads/);
  assert.doesNotMatch(trustedCaptureMigration, /ALTER TABLE platform\.crm_leads.*stage.*NEW_ENQUIRY/s);
});

test('trusted capture persistence is organization scoped and raw submissions are append-only', () => {
  assert.match(trustedCaptureMigration, /lead_capture_sources_organization_isolation/);
  assert.match(trustedCaptureMigration, /lead_capture_leads_organization_isolation/);
  assert.match(trustedCaptureMigration, /lead_capture_submissions_organization_isolation/);
  assert.match(trustedCaptureMigration, /current_context_can_access_organization/);
  assert.match(trustedCaptureMigration, /FORCE ROW LEVEL SECURITY/);
  assert.match(trustedCaptureMigration, /lead_capture_submissions_append_only/);
  assert.match(trustedCaptureMigration, /UNIQUE \(tenant_id, source_id, idempotency_key\)/);
});

test('CRM projection persists trusted capture layer provenance but never uses it for authorization', () => {
  assert.match(writer, /capture_layer_id = EXCLUDED\.capture_layer_id/);
  assert.match(writer, /input\.captureLayerId/);
  assert.match(organizationScopeMigration, /Never derived from capture_layer_id/);
  assert.match(organizationScopeMigration, /current_subject_can_access_organization/);
  assert.match(organizationScopeMigration, /organization_closure/);
});
