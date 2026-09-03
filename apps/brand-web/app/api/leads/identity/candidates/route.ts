import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';
import { listDuplicateCandidates } from '../../../../../lib/lead-identity-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    return await withBrandTransaction(context, async (client) => {
      const candidates = await listDuplicateCandidates(client, {
        tenantId: context.tenantId,
        organizationId: context.organizationId!,
      });
      return NextResponse.json({ candidates });
    });
  } catch (error) {
    console.error('Duplicate candidate read failed:', error);
    return NextResponse.json({ error: 'Unable to load duplicate candidates.' }, { status: 500 });
  }
}
