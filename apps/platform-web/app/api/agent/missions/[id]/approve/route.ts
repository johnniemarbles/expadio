import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';
import { randomUUID } from 'node:crypto';
import { ChiefOfStaffOrchestrator, type AgentToolAuthorizationPort, type AgentToolAdapter } from '@expadio/agent-runtime';
import { PostgresChiefOfStaffRepository } from '@expadio/postgres-runtime/chief-of-staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const { id: missionId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const approved = Boolean(body.approved);
    const approvalId = typeof body.approvalId === 'string' ? body.approvalId : null;

    if (!approvalId) {
      return NextResponse.json({ error: 'APPROVAL_ID_REQUIRED' }, { status: 400 });
    }

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
    const status = await withTenantTransaction(context, async (client) => {
      const orchestrator = new ChiefOfStaffOrchestrator({ executorOptions: { authorizationPort, registeredTools: [contextObserveTool] } });
      return orchestrator.resolveApproval(new PostgresChiefOfStaffRepository(client), {
        approvalId, missionId, tenantId: context.tenantId, approved,
      }, () => {});
    });

    if (!status) return NextResponse.json({ error: 'APPROVAL_NOT_PENDING' }, { status: 409 });

    return NextResponse.json({ ok: true, missionId, approved, status });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    return NextResponse.json({ error }, { status: 500 });
  }
}
