import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import {
  ChiefOfStaffOrchestrator,
  ChiefOfStaffApprovalError,
  type AgentToolAuthorizationPort,
  type AgentToolAdapter,
} from '@expadio/agent-runtime';
import { PostgresChiefOfStaffRepository } from '@expadio/postgres-runtime/chief-of-staff';
import { resolveBrandContext, withBrandTransaction } from '../../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await resolveBrandContext();
    const { id: missionId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const approvalId = typeof body.approvalId === 'string' ? body.approvalId : null;
    if (!approvalId) return NextResponse.json({ error: 'APPROVAL_ID_REQUIRED' }, { status: 400 });

    const authorizationPort: AgentToolAuthorizationPort = {
      async authorize(query) {
        const decisionId = randomUUID();
        return query.tenantId === context.tenantId && query.effect === 'OBSERVE'
          ? { decisionId, allowed: true, reasonKey: 'TENANT_SCOPED_OBSERVE_ALLOWED' }
          : { decisionId, allowed: false, reasonKey: 'PROPOSE_REQUIRES_POLICY' };
      },
    };
    const contextObserveTool: AgentToolAdapter = {
      toolKey: 'cbos.context.observe', effect: 'OBSERVE',
      async invoke(input) {
        return { executionId: input.executionId, tenantId: input.tenantId, toolKey: 'cbos.context.observe', kind: 'OBSERVATION', outputReference: `artifact:cbos:context:${input.tenantId}:${input.executionId}`, sourceReferences: [input.contextBundleReference], producedAt: new Date().toISOString() };
      },
    };
    let status: Awaited<ReturnType<ChiefOfStaffOrchestrator['resolveApproval']>>;
    try {
      status = await withBrandTransaction(context, async (client: PoolClient) => new ChiefOfStaffOrchestrator({
        executorOptions: { authorizationPort, registeredTools: [contextObserveTool] },
      }).resolveApproval(new PostgresChiefOfStaffRepository(client), {
        approvalId, missionId, tenantId: context.tenantId, approved: Boolean(body.approved),
        approverSubjectId: context.subjectId,
      }, () => {}));
    } catch (err) {
      if (err instanceof ChiefOfStaffApprovalError && err.code === 'AGENT_SELF_APPROVAL_DENIED') {
        return NextResponse.json({ error: err.code }, { status: 403 });
      }
      throw err;
    }

    if (!status) return NextResponse.json({ error: 'APPROVAL_NOT_PENDING' }, { status: 409 });
    return NextResponse.json({ ok: true, missionId, status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'INTERNAL_ERROR' }, { status: 500 });
  }
}
