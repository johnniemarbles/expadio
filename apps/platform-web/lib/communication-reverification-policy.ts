/** Clerk interprets verification age in minutes, using signed session claims.
 * multi_factor uses both factors when enrolled; Clerk falls back to first
 * factor for users without MFA. This policy does not enforce MFA enrollment. */
export const COMMUNICATION_REVERIFICATION = { level: 'multi_factor', afterMinutes: 5 } as const;

export function hasRecentCommunicationVerification(
  session: { userId: string | null; has: (request: { reverification: typeof COMMUNICATION_REVERIFICATION }) => boolean },
  expectedSubjectId: string,
): boolean {
  return expectedSubjectId.length > 0
    && session.userId === expectedSubjectId
    && session.has({ reverification: COMMUNICATION_REVERIFICATION }) === true;
}
