import 'server-only';
import { auth, reverificationErrorResponse } from '@clerk/nextjs/server';
import { COMMUNICATION_REVERIFICATION, hasRecentCommunicationVerification } from './communication-reverification-policy';

/** Call after platform authority and before reading bodies or doing work.
 * Return Clerk's challenge unchanged so useReverification can retry only the
 * denied HTTP request. No request header can assert verification freshness. */
export async function requireCommunicationReverification(subjectId: string): Promise<Response | null> {
  const session = await auth();
  if (!session.userId || session.userId !== subjectId) {
    return Response.json({ error: 'Sign in again to continue.', reasonKey: 'UNAUTHENTICATED' }, { status: 401 });
  }
  if (hasRecentCommunicationVerification(session, subjectId)) return null;
  const response = reverificationErrorResponse(COMMUNICATION_REVERIFICATION);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
