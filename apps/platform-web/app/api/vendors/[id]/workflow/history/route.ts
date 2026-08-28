import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../../lib/request-context';
import { loadCaseWorkflowHistory } from '../../../../../../lib/workflow-runtime';

/**
 * The governed trace for a vendor's workflow: its append-only stage transitions
 * and immutable decisions, one chronological timeline. A membership read; RLS
 * keeps it within the caller's tenant.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveRequestContext(request);
    const vendorId = decodeURIComponent((await params).id);

    const result = await withTenantClient(context, async (client) => {
      const row = await client.query(
        `SELECT workflow_instance_id FROM platform.vendors WHERE vendor_id = $1::uuid`,
        [vendorId],
      );
      if (row.rows.length === 0) return { notFound: true } as const;
      const instanceId = row.rows[0].workflow_instance_id as string | null;
      if (instanceId === null) return { entries: [] } as const;
      const entries = await loadCaseWorkflowHistory(client, { tenantId: context.tenantId, instanceId });
      return { entries } as const;
    });

    if ('notFound' in result) {
      return NextResponse.json({ error: 'That vendor was not found in this workspace.' }, { status: 404 });
    }
    return NextResponse.json({ entries: result.entries });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
