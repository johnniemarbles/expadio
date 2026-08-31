import { auth } from '@clerk/nextjs/server';
import { dbPool } from '../../../../lib/iam-adapter';
import { brandErrorResponse, serveBrandJourneyFallback } from '../../../../lib/brand-host-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    return await serveBrandJourneyFallback(request, userId, dbPool);
  } catch (error) {
    return brandErrorResponse(error);
  }
}
