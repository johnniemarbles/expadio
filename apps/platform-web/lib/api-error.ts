/**
 * Turns a failed JSON API response body into a human-readable message.
 *
 * Governed routes deny with `{ denied: true, reasonKey: 'FORBIDDEN' }` and no
 * `error` field, which would otherwise surface as a generic fallback. Map the
 * common reason keys to something an operator can act on, and prefer any
 * explicit `error`/`message` the route supplied.
 */

const REASON_MESSAGES: Record<string, string> = {
  FORBIDDEN: "You need a platform administration role to do this.",
  UNAUTHENTICATED: "Your session has expired. Sign in again.",
  TENANT_ACCESS_DENIED: "You do not have access to this workspace.",
  STEP_UP_REQUIRED: "Confirm your identity again to continue.",
  STEP_UP_EXPIRED: "Your confirmation expired. Try again.",
  DUAL_CONTROL_REQUIRED: "A second platform admin's approval is required.",
};

export function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.reasonKey === "string" && REASON_MESSAGES[record.reasonKey]) {
      return REASON_MESSAGES[record.reasonKey];
    }
  }
  return fallback;
}
