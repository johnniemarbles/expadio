import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import { createCrmContact, listCrmContacts } from '../../../../lib/brand-contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    return await withBrandTransaction(context, async (client) => {
      const contacts = await listCrmContacts(client, { tenantId: context.tenantId });
      return NextResponse.json({ contacts });
    });
  } catch (error) {
    console.error('Contact list failed:', error);
    return NextResponse.json({ error: 'Unable to load contacts.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    const body = await request.json();
    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN' }, { status: 403 });
      }
      try {
        const contact = await createCrmContact(client, { tenantId: context.tenantId, body });
        return NextResponse.json({ success: true, contact }, { status: 201 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'CONTACT_NAME_REQUIRED') return NextResponse.json({ error: 'Full name is required.', field: 'fullName' }, { status: 400 });
        if (msg === 'CONTACT_EMAIL_INVALID') return NextResponse.json({ error: 'Enter a valid email address.', field: 'email' }, { status: 400 });
        if ((err as any)?.code === '23505') return NextResponse.json({ error: 'A contact with that email already exists.', field: 'email' }, { status: 409 });
        throw err;
      }
    });
  } catch (error) {
    console.error('Contact creation failed:', error);
    return NextResponse.json({ error: 'Unable to create contact.' }, { status: 500 });
  }
}
