/**
 * Whether a subject should receive the platform-admin / tenant-owner grant.
 *
 * An explicit allowlist (PLATFORM_ADMIN_SUBJECTS) is the production mechanism;
 * DEMO_OPEN_ADMIN is an explicit non-production opt-in. Kept in
 * its own dependency-free module so it is unit-testable without loading the DB
 * pool or Clerk.
 */
export function shouldGrantPlatformAdmin(
  subjectId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const allowlist = (environment.PLATFORM_ADMIN_SUBJECTS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (allowlist.includes(subjectId)) return true;
  return environment.NODE_ENV !== 'production'
    && environment.DEMO_OPEN_ADMIN?.toLowerCase() === 'true';
}
