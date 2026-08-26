import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { ContextSlice } from '../../../../lib/brain-contracts';
import type { DeniedResult } from '@expadio/ui/contracts';

export async function GET(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    const denied: DeniedResult = {
      denied: true,
      reasonKey: 'UNAUTHENTICATED',
      message: 'User is not authenticated'
    };
    return NextResponse.json(denied, { status: 401 });
  }

  const slices: ContextSlice[] = [
    { id: 'slice_live_eu', purpose: 'EU Data Protection', sourceCount: 15, itemLimit: 100, tenantScope: 'Global', lastResolved: new Date().toISOString() },
    { id: 'slice_live_hr', purpose: 'HR Onboarding Standards', sourceCount: 8, itemLimit: 50, tenantScope: 'North America', lastResolved: new Date().toISOString() }
  ];

  return NextResponse.json(slices);
}
