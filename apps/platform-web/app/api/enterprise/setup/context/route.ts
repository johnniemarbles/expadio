import { NextResponse } from 'next/server';
import {
  enterpriseSetupErrorResponse,
  listSetupAccessForCurrentUser,
} from '../../../../../lib/enterprise-setup-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const contexts = await listSetupAccessForCurrentUser();
    return NextResponse.json(
      { contexts },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    const denied = enterpriseSetupErrorResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
