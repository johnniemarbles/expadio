import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../../../lib/brand-context';
import { reverseContactMerge } from '../../../../../../../lib/lead-identity-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function POST(_request: Request, { params }: { params: Promise<{ mergeId: string }> }) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    const mergeId = (await params).mergeId.trim();
    if (!UUID.test(mergeId)) {
      return NextResponse.json({ error: 'A valid mergeId is required.' }, { status: 400 });
    }
    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }
      const outcome = await reverseContactMerge(client, {
        tenantId: context.tenantId,
        organizationId: context.organizationId!,
        mergeId,
        subjectId: context.subjectId,
      });
      if (!outcome.ok) {
        return NextResponse.json({ error: outcome.reason, reasonKey: outcome.reasonCode }, { status: 409 });
      }
      return NextResponse.json({ success: true, ...outcome });
    });
  } catch (error) {
    console.error('Merge reversal failed:', error);
    return NextResponse.json({ error: 'Unable to reverse the merge.' }, { status: 500 });
  }
}
