import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import { createCrmAccount, listCrmAccounts } from '../../../../lib/brand-contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    return await withBrandTransaction(context, async (client) => {
      const accounts = await listCrmAccounts(client, {
        tenantId: context.tenantId,
        organizationId: context.organizationId!,
      });
      return NextResponse.json({ accounts });
    });
  } catch (error) {
    console.error('Account list failed:', error);
    return NextResponse.json({ error: 'Unable to load accounts.' }, { status: 500 });
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
        const account = await createCrmAccount(client, {
          tenantId: context.tenantId,
          organizationId: context.organizationId!,
          body,
        });
        return NextResponse.json({ success: true, account }, { status: 201 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'ACCOUNT_NAME_REQUIRED') return NextResponse.json({ error: 'Account name is required.', field: 'name' }, { status: 400 });
        if (msg === 'ACCOUNT_DOMAIN_INVALID') return NextResponse.json({ error: 'Enter a valid domain (e.g. acme.com).', field: 'domain' }, { status: 400 });
        if ((err as any)?.code === '23505') return NextResponse.json({ error: 'An account with that domain already exists.', field: 'domain' }, { status: 409 });
        throw err;
      }
    });
  } catch (error) {
    console.error('Account creation failed:', error);
    return NextResponse.json({ error: 'Unable to create account.' }, { status: 500 });
  }
}
