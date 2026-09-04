/**
 * Shared HTTP glue for the PUBLIC (Rail B) capture endpoints: CORS, request-
 * scoped RLS context, the source lookup, and the publishable-key/origin check.
 * The two routes (ingress + verify) both go through these so the trust checks
 * cannot drift apart.
 */
import {
  CAPTURE_IDEMPOTENCY_HEADER,
  CAPTURE_PUBLISHABLE_KEY_HEADER,
  normalizeCaptureSourcePublicationConfig,
  type CaptureSourcePublicationConfig,
} from '@expadio/lead-capture';
import { originAllowed } from './lead-capture-public-source.ts';
import { isValidPublishableKey } from './lead-capture-public-guard.ts';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface CaptureClient {
  query<Row = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

export interface PublicSourceRow {
  source_id: string;
  tenant_id: string;
  organization_id: string;
  source_key: string;
  layer_key: string | null;
  publishable_key: string | null;
  allowed_origins: string[] | null;
  status: string;
  trust_rail: string;
  publication_config: CaptureSourcePublicationConfig;
}

export function corsHeaders(origin: string | null, allowed: boolean): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin', 'Cache-Control': 'no-store' };
  if (origin && allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = `content-type, ${CAPTURE_PUBLISHABLE_KEY_HEADER}, ${CAPTURE_IDEMPOTENCY_HEADER}`;
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}

/** Transaction-local GUCs the PUBLIC ingress RLS policies read. Must be set
 *  after each BEGIN (is_local resets on COMMIT). */
export async function setPublicIngressContext(client: CaptureClient, tenantId: string, sourceId: string): Promise<void> {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  await client.query("SELECT set_config('app.lead_capture_public_source_id', $1, true)", [sourceId]);
}

export async function loadPublicSource(client: CaptureClient, tenantId: string, sourceId: string): Promise<PublicSourceRow | null> {
  const result = await client.query<PublicSourceRow>(
    `SELECT source_id, tenant_id, organization_id, source_key, layer_key, publishable_key,
            allowed_origins, status, trust_rail, metadata
       FROM platform.lead_capture_sources
      WHERE tenant_id = $1::uuid AND source_id = $2::uuid AND trust_rail = 'PUBLIC'
      LIMIT 1`,
    [tenantId, sourceId],
  );
  const row = result.rows[0] as (PublicSourceRow & { metadata?: { publicationConfig?: unknown } }) | undefined;
  if (!row) return null;
  return {
    ...row,
    publication_config: normalizeCaptureSourcePublicationConfig(row.metadata?.publicationConfig ?? {}),
  };
}

export type KeyOriginCheck = { readonly ok: true } | { readonly ok: false; readonly status: number; readonly error: string };

/** Order matters: a missing/inactive source is 404 (no existence oracle), a bad
 *  key is 401, a disallowed origin is 403. Publishable keys are public, so a
 *  plain comparison is fine — the OTP gate, not the key, protects the pipeline. */
export function checkKeyAndOrigin(source: PublicSourceRow, publishableKey: string | null, origin: string | null): KeyOriginCheck {
  if (source.status !== 'ACTIVE') return { ok: false, status: 404, error: 'Capture source is unavailable.' };
  if (!isValidPublishableKey(publishableKey) || publishableKey !== source.publishable_key) {
    return { ok: false, status: 401, error: 'Invalid capture key.' };
  }
  if (!originAllowed(source.allowed_origins ?? [], origin)) {
    return { ok: false, status: 403, error: 'Origin not allowed for this capture source.' };
  }
  return { ok: true };
}
