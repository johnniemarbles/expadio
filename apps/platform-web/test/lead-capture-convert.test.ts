import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CaptureScopeRejected,
  buildCaptureConvertWrite,
  principalFromResolvedContext,
  rejectCaptureBodyScope,
} from '../lib/lead-capture-convert.ts';
import { LeadValidationError } from '@expadio/lead';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const fromCapture = read('../app/api/crm/leads/from-capture/route.ts');
const customerConvert = read('../app/api/crm/leads/[id]/convert/route.ts');
const writer = read('../lib/lead-capture-convert.ts');
const leadDomain = read('../../../packages/lead/src/index.ts');
const migration = read('../../../infra/db/migrations/0087_lead_capture_convert_seam.sql');
const customerConvertSource = customerConvert;

const context = {
  subjectId: 'user_1',
  tenantId: '11111111-1111-1111-1111-111111111111',
  organizationId: '22222222-2222-2222-2222-222222222222',
  platformScope: false,
  applyTo: async () => undefined,
};

test('from-capture is a governed tenant write and does not delete capture', () => {
  assert.match(fromCapture, /resolveRequestContext\(request\)/);
  assert.match(fromCapture, /withTenantTransaction/);
  assert.match(fromCapture, /hasCrmWriteRole/);
  assert.match(fromCapture, /buildCaptureConvertWrite/);
  assert.match(fromCapture, /capturePreserved: true/);
  assert.match(fromCapture, /deleteCapture: false/);
  assert.match(writer, /ON CONFLICT \(tenant_id, capture_lead_id\)/);
  assert.doesNotMatch(fromCapture, /LAB_TRUSTED_HEADERS/);
  assert.doesNotMatch(fromCapture, /\/brand\/leads/);
  assert.doesNotMatch(fromCapture, /lib\/leads\/service/);
});

test('customer convert funnel stays a separate route', () => {
  assert.match(customerConvertSource, /Convert a won piece of business into a customer/);
  assert.doesNotMatch(customerConvertSource, /buildCrmLeadFromCapture/);
  assert.doesNotMatch(customerConvertSource, /from-capture/);
});

test('domain mapper and provenance columns stay on the 5-stage CRM', () => {
  assert.match(leadDomain, /export function mapCaptureStageToCrm/);
  assert.match(leadDomain, /export function buildCrmLeadFromCapture/);
  assert.match(leadDomain, /DEMAND_CAPTURE_LEAD_SOURCE = 'web_form'/);
  assert.doesNotMatch(leadDomain, /NEW_ENQUIRY.*platform\.crm_leads/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS capture_lead_id uuid/);
  assert.match(migration, /crm_leads_tenant_capture_uidx/);
  assert.doesNotMatch(migration, /CREATE TABLE lead_mgmt/);
});

test('P16 rejects body tenant / brand / layer claims', () => {
  assert.throws(() => rejectCaptureBodyScope({ tenantId: 'forged' }), CaptureScopeRejected);
  assert.throws(() => rejectCaptureBodyScope({ brandId: 'b1' }), CaptureScopeRejected);
  assert.throws(() => rejectCaptureBodyScope({ layerId: 'in' }), CaptureScopeRejected);
  rejectCaptureBodyScope({ captureLeadId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', captureStage: 'NEW_ENQUIRY' });
});

test('writer principal comes from gateway context, not the body', () => {
  const principal = principalFromResolvedContext(context);
  assert.equal(principal.tenantId, context.tenantId);
  const write = buildCaptureConvertWrite(
    {
      captureLeadId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      captureStage: 'APPLICATION_STARTED',
      email: 'ada@brand.com',
      captureLayerId: 'in-tn-u1',
    },
    context,
  );
  assert.equal(write.principal.tenantId, context.tenantId);
  assert.equal(write.deleteCapture, false);
  assert.equal(write.input.source, 'web_form');
  assert.equal(write.input.stage, 'PROPOSAL');
  assert.throws(
    () => buildCaptureConvertWrite({ tenantId: 'forged', captureLeadId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', captureStage: 'NEW_ENQUIRY' }, context),
    CaptureScopeRejected,
  );
  assert.throws(
    () => buildCaptureConvertWrite({ captureLeadId: 'nope', captureStage: 'NEW_ENQUIRY' }, context),
    LeadValidationError,
  );
});
