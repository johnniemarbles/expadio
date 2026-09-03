/**
 * Trusted Capture → thin CRM writer (I8 / ADR-011).
 *
 * The request may identify a capture lead, but cannot assert its stage, payload,
 * organization, or layer provenance. Those fields are loaded from persisted
 * Demand Capture state under the same organization-aware RLS context.
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
    super(`${field} is not accepted on the convert body. Capture scope and provenance come from trusted persisted capture state.`);
    this.name = 'CaptureScopeRejected';
    this.field = field;
  }
}

export interface CaptureSqlClient {
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export interface TrustedCaptureProjection {
  readonly organizationId: string;
  readonly ownerSubjectId: string | null;
  readonly snapshot: CaptureConvertSnapshot;
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

/**
 * The projection request is a reference, not a capture payload. Any attempt to
 * smuggle capture state or scope through JSON is rejected rather than ignored.
 */
export function captureLeadIdFromConvertBody(body: unknown): string {
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  for (const field of [
    'tenantId', 'brandId', 'organizationId', 'layerId', 'captureLayerId',
    'captureStage', 'title', 'email', 'rawPayload', 'contactId', 'accountId',
  ] as const) {
    if (record[field] !== undefined && record[field] !== null && record[field] !== '') {
      throw new CaptureScopeRejected(field);
    }
  }
  const captureLeadId = typeof record.captureLeadId === 'string' ? record.captureLeadId.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(captureLeadId)) {
    throw new LeadValidationError('captureLeadId', 'captureLeadId must be a valid identifier.');
  }
  return captureLeadId;
}

/**
 * Load authoritative capture state under RLS. Selected-workspace subtree scope is
 * enforced by lead_capture_leads/source policies; this query also pins tenant_id.
 */
export type TrustedCaptureProjectionResult =
  | ({ readonly kind: 'ok' } & TrustedCaptureProjection)
  | { readonly kind: 'not_found' }
  | { readonly kind: 'verification_required' };

export async function loadTrustedCaptureProjection(
  client: CaptureSqlClient,
  input: { readonly tenantId: string; readonly captureLeadId: string },
): Promise<TrustedCaptureProjectionResult> {
  const result = await client.query<{
    capture_lead_id: string;
    tenant_id: string;
    organization_id: string;
    title: string | null;
    email: string | null;
    stage: string;
    raw_payload: Record<string, unknown>;
    owner_subject_id: string | null;
    layer_key: string | null;
    verification_state: string;
  }>(
    `SELECT l.capture_lead_id, l.tenant_id, l.organization_id, l.title, l.email,
            l.stage, l.raw_payload, l.owner_subject_id, l.verification_state, s.layer_key
       FROM platform.lead_capture_leads l
       JOIN platform.lead_capture_sources s
         ON s.source_id = l.source_id
        AND s.tenant_id = l.tenant_id
        AND s.organization_id = l.organization_id
      WHERE l.capture_lead_id = $1::uuid
        AND l.tenant_id = $2::uuid`,
    [input.captureLeadId, input.tenantId],
  );
  const row = result.rows[0];
  if (!row) return { kind: 'not_found' };
  if (row.verification_state === 'UNVERIFIED') return { kind: 'verification_required' };
  return {
    kind: 'ok',
    organizationId: row.organization_id,
    ownerSubjectId: row.owner_subject_id,
    snapshot: {
      captureLeadId: row.capture_lead_id,
      tenantId: row.tenant_id,
      title: row.title ?? undefined,
      email: row.email ?? undefined,
      captureStage: row.stage,
      captureLayerId: row.layer_key ?? undefined,
      rawPayload: row.raw_payload ?? {},
    },
  };
}

export const UPSERT_CAPTURE_CRM_LEAD_SQL = `
INSERT INTO platform.crm_leads
  (tenant_id, organization_id, account_id, contact_id, title, stage, amount_minor_units, currency,
   source, raw_payload, owner_subject_id, capture_lead_id, capture_layer_id)
VALUES
  ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::uuid, $13)
ON CONFLICT (tenant_id, capture_lead_id) WHERE capture_lead_id IS NOT NULL
DO UPDATE SET
  stage = EXCLUDED.stage,
  raw_payload = EXCLUDED.raw_payload,
  capture_layer_id = EXCLUDED.capture_layer_id,
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
    input.captureLayerId,
  ];
}

export function buildTrustedCaptureConvertWrite(
  projection: TrustedCaptureProjection | (TrustedCaptureProjection & { kind: 'ok' }),
  context: ResolvedRequestContext,
): {
  readonly principal: ReturnType<typeof principalFromResolvedContext>;
  readonly organizationId: string;
  readonly ownerSubjectId: string;
  readonly input: ValidatedLeadInput;
  readonly capturePreserved: true;
  readonly deleteCapture: false;
} {
  const principal = principalFromResolvedContext(context);
  if (projection.snapshot.tenantId !== principal.tenantId) throw new CaptureScopeRejected('tenantId');
  const mapped = buildCrmLeadFromCapture(projection.snapshot);
  return {
    principal,
    organizationId: projection.organizationId,
    ownerSubjectId: projection.ownerSubjectId ?? context.subjectId,
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
    amountMinorUnits: row.amount_minor_units == null ? null : Number(row.amount_minor_units),
    currency: row.currency,
    source: row.source ?? null,
    rawPayload: payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {},
    ownerSubjectId: row.owner_subject_id ?? null,
    captureLeadId: row.capture_lead_id ?? null,
    captureLayerId: row.capture_layer_id ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
