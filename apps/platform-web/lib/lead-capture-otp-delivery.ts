/**
 * OTP delivery seam.
 *
 * The PUBLIC capture gate creates a hashed OTP challenge; the plaintext code must
 * reach the prospect over their channel. That send belongs to the Communications
 * engine (consent-gated), which is wired in the next step. Until then this is a
 * deliberate no-op: capture still succeeds and the challenge is stored, but no
 * code is dispatched, so verification cannot complete in production yet. The code
 * is NEVER logged or returned to the caller.
 */
export interface CaptureOtpDelivery {
  readonly tenantId: string;
  readonly organizationId: string;
  readonly captureLeadId: string;
  readonly channel: 'EMAIL' | 'SMS';
  /** Plaintext code — pass to the sender, never persist or log it. */
  readonly code: string;
  /** Raw destination (email/phone). Not stored; only the hash is persisted. */
  readonly destination: string;
}

export async function deliverCaptureOtp(_delivery: CaptureOtpDelivery): Promise<void> {
  // Intentionally not implemented. The Communications integration (Gate 2) will
  // resolve the consented template/provider and dispatch the code. Do not log
  // `_delivery.code` here or anywhere.
  return;
}
