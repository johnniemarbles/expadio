/**
 * Browser capture client — the PUBLIC (Rail B) path.
 *
 * Runs in an untrusted browser: it holds a *publishable* key (not a secret),
 * sends the browser's Origin automatically, and posts a normalized submission to
 * the public ingress. It never chooses tenant/organization/stage — the source
 * resolved from the publishable key does. Pipeline entry is still gated by OTP
 * server-side; a 202 here means "captured", not "qualified".
 */
import {
  CAPTURE_IDEMPOTENCY_HEADER,
  CAPTURE_PUBLISHABLE_KEY_HEADER,
  serializeSubmission,
  type CaptureAttribution,
  type CaptureSubmissionInput,
} from './contract.ts';
import { normalizeSubmission } from './normalize.ts';

export interface CaptureResult {
  readonly accepted: boolean;
  readonly replayed: boolean;
  readonly captureLeadId: string | null;
  /** True when the server parked the submission awaiting OTP verification. */
  readonly requiresVerification: boolean;
}

export interface BrowserCaptureClientOptions {
  /** Absolute URL of the PUBLIC ingress endpoint. */
  readonly endpoint: string;
  /** Public source identifier, `cpk_...`. */
  readonly publishableKey: string;
  /** Fill missing attribution from the current page. Default true. */
  readonly captureAttribution?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly idempotencyKey?: () => string;
}

export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Non-crypto fallback for environments without randomUUID; the server still
  // enforces per-source uniqueness, so this only needs to be locally unique.
  return `idmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Read page-level attribution the caller did not supply. Browser-only; a no-op
 *  when there is no document/location (SSR, tests). */
export function pageAttribution(): CaptureAttribution {
  const loc = (globalThis as { location?: Location }).location;
  const doc = (globalThis as { document?: Document }).document;
  if (!loc) return {};
  const params = new URLSearchParams(loc.search);
  const q = (name: string) => params.get(name) ?? undefined;
  return {
    pageUrl: loc.href,
    referrerUrl: doc?.referrer || undefined,
    utmSource: q('utm_source'),
    utmMedium: q('utm_medium'),
    utmCampaign: q('utm_campaign'),
    utmTerm: q('utm_term'),
    utmContent: q('utm_content'),
    utmId: q('utm_id'),
    gclid: q('gclid'),
    fbclid: q('fbclid'),
    referralCode: q('ref') ?? q('referral_code'),
  };
}

function mergeAttribution(base: CaptureAttribution, add: CaptureAttribution): CaptureAttribution {
  const out: Record<string, unknown> = { ...add };
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out as CaptureAttribution;
}

export function createBrowserCaptureClient(options: BrowserCaptureClientOptions) {
  if (!/^cpk_[A-Za-z0-9]{32,64}$/u.test(options.publishableKey)) {
    throw new Error('A valid publishable key (cpk_...) is required.');
  }
  const doFetch = options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;
  if (!doFetch) throw new Error('No fetch implementation is available.');
  const nextKey = options.idempotencyKey ?? newIdempotencyKey;
  const withAttribution = options.captureAttribution !== false;

  async function submit(input: CaptureSubmissionInput): Promise<CaptureResult> {
    const attribution = withAttribution
      ? mergeAttribution(input.attribution ?? {}, pageAttribution())
      : input.attribution;
    const submission = normalizeSubmission({ ...input, attribution });
    const body = serializeSubmission(submission);
    const response = await doFetch(options.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CAPTURE_PUBLISHABLE_KEY_HEADER]: options.publishableKey,
        [CAPTURE_IDEMPOTENCY_HEADER]: nextKey(),
      },
      body,
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `Capture failed (${response.status}).`);
    }
    return {
      accepted: payload.accepted === true,
      replayed: payload.replayed === true,
      captureLeadId: typeof payload.captureLeadId === 'string' ? payload.captureLeadId : null,
      requiresVerification: payload.requiresVerification === true,
    };
  }

  return { submit };
}
