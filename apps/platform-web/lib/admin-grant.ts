/**
 * Explicit bootstrap/platform-admin allowlist helper.
 *
 * No environment default grants privilege. A subject is privileged only when
 * named explicitly by CLERK_ADMIN_USER_ID or PLATFORM_ADMIN_SUBJECTS.
 */
export function shouldGrantPlatformAdmin(subjectId: string): boolean {
  const allowlist = (process.env.PLATFORM_ADMIN_SUBJECTS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const bootstrap = process.env.CLERK_ADMIN_USER_ID?.trim();
  return bootstrap === subjectId || allowlist.includes(subjectId);
}
