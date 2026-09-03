/**
 * @expadio/lead-capture — the submission payload contract.
 *
 * One canonical shape that BOTH capture rails and every surface (embedded form,
 * SDK, hosted landing page, inbound adapters) produce and the ingress consumes.
 * This module is pure and transport-agnostic: no DOM, no network, no crypto. It
 * defines the shape, the limits, the wire header names, and a stable
 * serialization so a signed body and its signature always describe the same
 * bytes.
 *
 * The contract mirrors BEMP Leads Module Spec v2.0 §3.4, kept to the fields the
 * pipeline actually reads today plus an open `fields` bag for per-form data.
 * Authority fields (tenant, organization, layer, stage) are DELIBERATELY absent:
 * a client never asserts scope — the source row does. Anything extra a caller
 * sends is preserved in the raw payload but never trusted as scope.
 */

/** Wire headers. The signed set already exists on the live ingress; the
 *  publishable-key header is the PUBLIC (browser) rail's identifier. */
export const CAPTURE_SIGNATURE_HEADER = 'x-expadio-capture-signature';
export const CAPTURE_TIMESTAMP_HEADER = 'x-expadio-capture-timestamp';
export const CAPTURE_IDEMPOTENCY_HEADER = 'x-expadio-idempotency-key';
export const CAPTURE_PUBLISHABLE_KEY_HEADER = 'x-expadio-capture-key';

export function publicCaptureUrl(baseUrl: string, tenantId: string, sourceId: string): string {
  return `${baseUrl.replace(/\/$/u, '')}/api/lead-capture/public/${encodeURIComponent(sourceId)}?tenantId=${encodeURIComponent(tenantId)}`;
}

export function publicVerifyUrl(baseUrl: string, tenantId: string, sourceId: string): string {
  return `${baseUrl.replace(/\/$/u, '')}/api/lead-capture/public/${encodeURIComponent(sourceId)}/verify?tenantId=${encodeURIComponent(tenantId)}`;
}

export interface BrowserCaptureClientOptions {
  readonly baseUrl: string;
  readonly tenantId: string;
  readonly sourceId: string;
  readonly publishableKey: string;
  readonly captureAttribution?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly idempotencyKey?: () => string;
}

export interface CaptureResult {
  readonly accepted: boolean;
  readonly replayed: boolean;
  readonly captureLeadId: string | null;
  readonly requiresVerification: boolean;
}

export interface VerifyResult {
  readonly verified: boolean;
  readonly reason?: 'EXPIRED' | 'INVALID' | 'LOCKED';
  readonly remainingAttempts?: number;
}

/** Must match MAX_CAPTURE_BODY_BYTES on the server ingress. */
export const MAX_CAPTURE_BODY_BYTES = 256 * 1024;

export const CONSENT_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'VOICE'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

export interface CaptureContact {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email: string;
  readonly phone?: string;
  readonly phoneCountryCode?: string;
  readonly preferredLanguage?: string;
}

export interface CaptureOrganizationInput {
  readonly name?: string;
  readonly domain?: string;
  readonly roleTitle?: string;
}

export interface CaptureConsent {
  readonly channel: ConsentChannel;
  readonly purpose: string;
  readonly granted: boolean;
  readonly textVersion?: string;
}

export interface CaptureAttribution {
  readonly pageUrl?: string;
  readonly referrerUrl?: string;
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
  readonly utmTerm?: string;
  readonly utmContent?: string;
  readonly utmId?: string;
  readonly gclid?: string;
  readonly fbclid?: string;
  readonly referralCode?: string;
  readonly affiliateKey?: string;
}

export type CaptureFieldValue = string | number | boolean | null;

/** What a surface hands to the SDK. Loose on entry, normalized before the wire. */
export interface CaptureSubmissionInput {
  readonly contact: CaptureContact;
  readonly organization?: CaptureOrganizationInput;
  readonly consent?: readonly CaptureConsent[];
  readonly attribution?: CaptureAttribution;
  readonly title?: string;
  readonly externalReference?: string;
  readonly formId?: string;
  readonly formVersion?: string;
  readonly fields?: Readonly<Record<string, CaptureFieldValue>>;
}

/** The normalized, on-the-wire submission. Same shape both rails send. */
export interface CaptureSubmission {
  readonly contact: CaptureContact;
  readonly organization?: CaptureOrganizationInput;
  readonly consent: readonly CaptureConsent[];
  readonly attribution: CaptureAttribution;
  readonly title: string;
  readonly externalReference?: string;
  readonly formId?: string;
  readonly formVersion?: string;
  readonly fields: Readonly<Record<string, CaptureFieldValue>>;
}

export class CaptureContractError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CaptureContractError';
    this.code = code;
  }
}

/**
 * Deterministic JSON: object keys sorted recursively so the same logical
 * submission always serializes to the same bytes. This is what gets signed
 * (Rail A) and what a content hash of the body would key on.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

const encoder = new TextEncoder();

/** The exact bytes a Rail A signature covers: `${timestamp}.${body}`. */
export function captureSigningBytes(timestamp: string, body: Uint8Array): Uint8Array {
  const prefix = encoder.encode(`${timestamp}.`);
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return out;
}

/** Serialize a submission to the bytes posted (and, on Rail A, signed). Throws
 *  if the body exceeds the ingress size bound so the caller fails fast, not the
 *  server with a 413. */
export function serializeSubmission(submission: CaptureSubmission): Uint8Array {
  const bytes = encoder.encode(stableStringify(submission));
  if (bytes.length > MAX_CAPTURE_BODY_BYTES) {
    throw new CaptureContractError('CAPTURE_PAYLOAD_TOO_LARGE', 'Capture payload exceeds the maximum size.');
  }
  return bytes;
}
