import { auth } from '@clerk/nextjs/server';
import { refuseBrandJourneyWrite } from '@expadio/tenancy';
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

export async function POST(request: Request) {
  try {
    refuseBrandJourneyWrite(request.method);
    return brandErrorResponse(new Error('BRAND_JOURNEY_MUTATION_FORBIDDEN'));
  } catch (error) {
    return brandErrorResponse(error);
  }
}
