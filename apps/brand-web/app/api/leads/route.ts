import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../lib/brand-context';
import { createBrandLead, listBrandLeads } from '../../../lib/brand-leads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    return await withBrandTransaction(context, async (client) => {
      const leads = await listBrandLeads(client, {});
      return NextResponse.json({ leads });
    });
  } catch (error) {
    console.error('Lead list failed:', error);
    return NextResponse.json({ error: 'Unable to load leads.' }, { status: 500 });
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
        const lead = await createBrandLead(client, {
          tenantId: context.tenantId,
          organizationId: context.organizationId!,
          actorSubjectId: context.subjectId,
          body,
        });
        return NextResponse.json({ success: true, lead }, { status: 201 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'LEAD_TITLE_INVALID') return NextResponse.json({ error: 'Title is required (1–200 characters).', field: 'title' }, { status: 400 });
        if (msg === 'LEAD_EMAIL_INVALID') return NextResponse.json({ error: 'Enter a valid email address.', field: 'contactEmail' }, { status: 400 });
        if (msg === 'LEAD_CURRENCY_INVALID') return NextResponse.json({ error: 'Currency must be a 3-letter ISO code.', field: 'currency' }, { status: 400 });
        if (msg === 'LEAD_AMOUNT_INVALID') return NextResponse.json({ error: 'Amount must be a non-negative integer (minor units).', field: 'amountMinorUnits' }, { status: 400 });
        throw err;
      }
    });
  } catch (error) {
    console.error('Lead creation failed:', error);
    return NextResponse.json({ error: 'Unable to create lead.' }, { status: 500 });
  }
}
