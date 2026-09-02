/**
 * Capture → thin CRM writer (I8 / ADR-011).
 *
 * Distinct from POST /api/crm/leads/:id/convert, which turns a CRM lead into a
 * customer. This writer projects an extract capture snapshot onto
 * platform.crm_leads and never deletes capture history.
 */
import {
  buildCrmLeadFromCapture,
  LeadValidationError,
  type CaptureConvertSnapshot,
  type CrmLead,
  type ValidatedLeadInput,
} from '@expadio/lead';
import type { ResolvedRequestContext } from './request-context';

export class CaptureScopeRejected extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`${field} is not accepted on the convert body. Tenant, organization, and layer scope come from trusted server context.`);
    this.name = 'CaptureScopeRejected';
    this.field = field;
  }
}

/** Production principal. Never taken from the JSON body (P16). */
export function principalFromResolvedContext(context: ResolvedRequestContext): {
  readonly subjectId: string;
  readonly tenantId: string;
  readonly organizationId: string | null;
} {
  return {
    subjectId: context.subjectId,
    tenantId: context.tenantId,
    organizationId: context.organizationId,
  };
}

/** P16 — body may not choose tenant / brand / organization / capture layer. */
export function rejectCaptureBodyScope(body: unknown): void {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return;
  const record = body as Record<string, unknown>;
  for (const field of ['tenantId', 'brandId', 'organizationId', 'layerId', 'captureLayerId'] as const) {
    if (record[field] !== undefined && record[field] !== null && record[field] !== '') {
      throw new CaptureScopeRejected(field);
    }
  }
}

export function snapshotFromConvertBody(
  body: unknown,
  tenantId: string,
): CaptureConvertSnapshot {
  rejectCaptureBodyScope(body);
  const record = (body ?? {}) as Record<string, unknown>;
  const captureLeadId = typeof record.captureLeadId === 'string' ? record.captureLeadId.trim() : '';
  const captureStage = typeof record.captureStage === 'string' ? record.captureStage.trim() : '';
  if (captureLeadId === '') {
    throw new LeadValidationError('captureLeadId', 'captureLeadId is required.');
  }
  if (captureStage === '') {
    throw new LeadValidationError('captureStage', 'captureStage is required.');
  }
  const rawPayload =
    record.rawPayload && typeof record.rawPayload === 'object' && !Array.isArray(record.rawPayload)
      ? (record.rawPayload as Record<string, unknown>)
      : {};
  return {
    captureLeadId,
    tenantId,
    title: typeof record.title === 'string' ? record.title : undefined,
    email: typeof record.email === 'string' ? record.email : undefined,
    captureStage,
    contactId: typeof record.contactId === 'string' ? record.contactId : undefined,
    accountId: typeof record.accountId === 'string' ? record.accountId : undefined,
    rawPayload,
  };
}

export const UPSERT_CAPTURE_CRM_LEAD_SQL = `
INSERT INTO platform.crm_leads
  (tenant_id, organization_id, account_id, contact_id, title, stage, amount_minor_units, currency,
   source, raw_payload, owner_subject_id, capture_lead_id, capture_layer_id)
VALUES
  ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::uuid, NULL)
ON CONFLICT (tenant_id, capture_lead_id) WHERE capture_lead_id IS NOT NULL
DO UPDATE SET
  stage = EXCLUDED.stage,
  raw_payload = EXCLUDED.raw_payload,
  updated_at = now()
RETURNING lead_id, tenant_id, organization_id, account_id, contact_id, title, stage,
          amount_minor_units, currency, source, raw_payload, owner_subject_id,
          capture_lead_id, capture_layer_id, created_at, updated_at,
          (xmax = 0) AS inserted
`;

export function captureConvertBindParams(
  tenantId: string,
  organizationId: string,
  ownerSubjectId: string,
  input: ValidatedLeadInput,
): unknown[] {
  return [
    tenantId,
    organizationId,
    input.accountId,
    input.contactId,
    input.title,
    input.stage,
    input.amountMinorUnits,
    input.currency,
    input.source,
    JSON.stringify(input.rawPayload),
    ownerSubjectId,
    input.captureLeadId,
  ];
}

export function buildCaptureConvertWrite(
  body: unknown,
  context: ResolvedRequestContext,
): {
  readonly principal: ReturnType<typeof principalFromResolvedContext>;
  readonly input: ValidatedLeadInput;
  readonly capturePreserved: true;
  readonly deleteCapture: false;
} {
  const principal = principalFromResolvedContext(context);
  const mapped = buildCrmLeadFromCapture(snapshotFromConvertBody(body, principal.tenantId));
  return {
    principal,
    input: mapped.input,
    capturePreserved: true,
    deleteCapture: false,
  };
}

export function toCaptureCrmLead(row: {
  lead_id: string;
  tenant_id: string;
  organization_id: string;
  account_id?: string | null;
  contact_id?: string | null;
  title: string;
  stage: CrmLead['stage'];
  amount_minor_units?: string | number | null;
  currency: string;
  source?: string | null;
  raw_payload?: unknown;
  owner_subject_id?: string | null;
  capture_lead_id?: string | null;
  capture_layer_id?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}): CrmLead & { organizationId: string } {
  const payload = row.raw_payload;
  return {
    leadId: row.lead_id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    accountId: row.account_id ?? null,
    contactId: row.contact_id ?? null,
    title: row.title,
    stage: row.stage,
    amountMinorUnits:
      row.amount_minor_units === null || row.amount_minor_units === undefined
        ? null
        : Number(row.amount_minor_units),
    currency: row.currency,
    source: row.source ?? null,
    rawPayload: payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {},
    ownerSubjectId: row.owner_subject_id ?? null,
    captureLeadId: row.capture_lead_id ?? null,
    captureLayerId: row.capture_layer_id ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
