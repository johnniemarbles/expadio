import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';
import { searchCrmContacts } from '../../../../../lib/brand-contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveBrandContext();
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email')?.trim().toLowerCase() ?? '';
    const phone = searchParams.get('phone')?.trim() ?? '';
    const name = searchParams.get('name')?.trim() ?? '';

    if (!email && !phone && !name) return NextResponse.json({ contacts: [] });

    return await withBrandTransaction(context, async (client) => {
      const contacts = await searchCrmContacts(client, {
        tenantId: context.tenantId,
        email,
        phone,
        name,
      });
      return NextResponse.json({ contacts });
    });
  } catch (error) {
    console.error('Contact search failed:', error);
    return NextResponse.json({ error: 'Search failed.' }, { status: 500 });
  }
}
