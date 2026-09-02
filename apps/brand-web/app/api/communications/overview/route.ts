import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import { loadBrandCommunicationOverview } from '../../../../lib/brand-communications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const overview = await withBrandTransaction(context, (client) =>
      loadBrandCommunicationOverview(client, {
        tenantId: context.tenantId,
        organizationId: context.organizationId,
      }),
    );
    return NextResponse.json(overview);
  } catch (error) {
    console.error('Brand Communications overview failed', error);
    return NextResponse.json({
      denied: true,
      reasonKey: 'BRAND_COMMUNICATIONS_OVERVIEW_FAILED',
      message: 'Communications data could not be loaded for this Brand workspace.',
    }, { status: 500 });
  }
}
