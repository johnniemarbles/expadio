import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';
import { searchCrmAccounts } from '../../../../../lib/brand-contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name')?.trim() ?? '';
    const domain = searchParams.get('domain')?.trim().toLowerCase() ?? '';

    if (!name && !domain) return NextResponse.json({ accounts: [] });

    return await withBrandTransaction(context, async (client) => {
      const accounts = await searchCrmAccounts(client, {
        tenantId: context.tenantId,
        organizationId: context.organizationId!,
        name,
        domain,
      });
      return NextResponse.json({ accounts });
    });
  } catch (error) {
    console.error('Account search failed:', error);
    return NextResponse.json({ error: 'Search failed.' }, { status: 500 });
  }
}
