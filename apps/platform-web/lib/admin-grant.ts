/**
 * Whether a subject should receive the platform-admin / tenant-owner grant.
 *
 * An explicit allowlist (PLATFORM_ADMIN_SUBJECTS) is the production mechanism;
 * DEMO_OPEN_ADMIN keeps the demo open unless a deployment turns it off. Kept in
 * its own dependency-free module so it is unit-testable without loading the DB
 * pool or Clerk.
 */
export function shouldGrantPlatformAdmin(subjectId: string): boolean {
  const allowlist = (process.env.PLATFORM_ADMIN_SUBJECTS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (allowlist.includes(subjectId)) return true;
  return (process.env.DEMO_OPEN_ADMIN ?? 'true').toLowerCase() !== 'false';
}
