import {
  CAPTURE_IDEMPOTENCY_HEADER,
  CAPTURE_PUBLISHABLE_KEY_HEADER,
  publicCaptureUrl,
  publicVerifyUrl,
  serializeSubmission,
} from './contract.ts';
import { normalizeSubmission } from './normalize.ts';
import type {
  BrowserCaptureClientOptions,
  CaptureAttribution,
  CaptureResult,
  CaptureSubmissionInput,
  VerifyResult,
} from './contract.ts';

function newIdempotencyKey(): string {
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

  const out: Record<string, string> = { pageUrl: loc.href };
  if (doc?.referrer) out.referrerUrl = doc.referrer;

  const map: Record<string, string> = {
    utm_source: 'utmSource',
    utm_medium: 'utmMedium',
    utm_campaign: 'utmCampaign',
    utm_term: 'utmTerm',
    utm_content: 'utmContent',
    utm_id: 'utmId',
    gclid: 'gclid',
    fbclid: 'fbclid',
  };

  for (const [param, key] of Object.entries(map)) {
    const val = q(param);
    if (val) out[key] = val;
  }

  const ref = q('ref') ?? q('referral_code');
  if (ref) out.referralCode = ref;

  return out as CaptureAttribution;
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
  const doFetch = (options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch)!;
  if (!doFetch) throw new Error('No fetch implementation is available.');
  const nextKey = options.idempotencyKey ?? newIdempotencyKey;
  const withAttribution = options.captureAttribution !== false;
  const ingressUrl = publicCaptureUrl(options.baseUrl, options.tenantId, options.sourceId);
  const verifyEndpoint = publicVerifyUrl(options.baseUrl, options.tenantId, options.sourceId);

  async function submit(input: CaptureSubmissionInput): Promise<CaptureResult> {
    const attribution = withAttribution
      ? mergeAttribution(input.attribution ?? {}, pageAttribution())
      : input.attribution;
    const submission = normalizeSubmission({
      ...input,
      ...(attribution !== undefined ? { attribution } : {}),
    });
    const body = serializeSubmission(submission);
    const response = await doFetch(ingressUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CAPTURE_PUBLISHABLE_KEY_HEADER]: options.publishableKey,
        [CAPTURE_IDEMPOTENCY_HEADER]: nextKey(),
      },
      body,
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
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

  /** Complete the OTP gate for a captured lead. A non-2xx (wrong/expired/locked
   *  code) resolves to `{ verified: false, reason }` rather than throwing. */
  async function verify(captureLeadId: string, code: string): Promise<VerifyResult> {
    const response = await doFetch(verifyEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CAPTURE_PUBLISHABLE_KEY_HEADER]: options.publishableKey },
      body: JSON.stringify({ captureLeadId, code }),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok && payload.verified === true) return { verified: true };
    const reason = typeof payload.reason === 'string' ? (payload.reason as VerifyResult['reason']) : undefined;
    const remainingAttempts =
      typeof payload.remainingAttempts === 'number' ? payload.remainingAttempts : undefined;
    return {
      verified: false,
      ...(reason !== undefined ? { reason } : {}),
      ...(remainingAttempts !== undefined ? { remainingAttempts } : {}),
    };
  }

  return { submit, verify };
}
