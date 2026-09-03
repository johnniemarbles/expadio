import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';
import { confirmCandidateMerge, dismissCandidate } from '../../../../../../lib/lead-identity-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export async function POST(request: Request, { params }: { params: Promise<{ candidateId: string }> }) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    const candidateId = (await params).candidateId.trim();
    if (!UUID.test(candidateId)) {
      return NextResponse.json({ error: 'A valid candidateId is required.' }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : '';
    if (action !== 'confirm' && action !== 'dismiss') {
      return NextResponse.json({ error: "action must be 'confirm' or 'dismiss'." }, { status: 400 });
    }
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : undefined;

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }
      const scope = { tenantId: context.tenantId, organizationId: context.organizationId!, candidateId, subjectId: context.subjectId };
      const outcome = action === 'confirm'
        ? await confirmCandidateMerge(client, { ...scope, reason })
        : await dismissCandidate(client, scope);
      if (!outcome.ok) {
        const status = outcome.reasonCode === 'NOT_PENDING' ? 409 : 422;
        return NextResponse.json({ error: outcome.reason, reasonKey: outcome.reasonCode }, { status });
      }
      return NextResponse.json({ success: true, ...outcome });
    });
  } catch (error) {
    console.error('Duplicate candidate resolution failed:', error);
    return NextResponse.json({ error: 'Unable to resolve the candidate.' }, { status: 500 });
  }
}
