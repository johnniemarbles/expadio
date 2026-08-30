import { NextResponse } from 'next/server';
import { resolveRequestContext, deniedResponse } from '../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    return NextResponse.json({ canManageProviders: context.platformScope }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
