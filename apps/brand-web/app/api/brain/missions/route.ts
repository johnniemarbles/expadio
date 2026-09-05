import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';
import {
  ChiefOfStaffOrchestrator,
  type AgentToolAuthorizationPort,
  type AgentToolAuthorizationQuery,
  type AgentToolAdapter,
  type AgentToolAdapterInput,
} from '@expadio/agent-runtime';
import { PostgresChiefOfStaffRepository } from '@expadio/postgres-runtime/chief-of-staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const result = await withBrandTransaction(context, async (client) => {
      const [missionsRes, tasksRes, approvalsRes] = await Promise.all([
        client.query(
          `SELECT mission_id, tenant_id, user_subject_id, intent, status, summary, created_at, updated_at
             FROM platform.agent_missions
            WHERE tenant_id = $1::uuid
            ORDER BY created_at DESC
            LIMIT 50`,
          [context.tenantId],
        ),
        client.query(
          `SELECT task_id, mission_id, tenant_id, assigned_agent_id, title, description,
                  requires_approval, status, error, started_at, completed_at, created_at
             FROM platform.agent_tasks
            WHERE tenant_id = $1::uuid
            ORDER BY created_at DESC
            LIMIT 100`,
          [context.tenantId],
        ),
        client.query(
          `SELECT approval_id, mission_id, task_id, tenant_id, title, description,
                  staged_changes, status, created_at, resolved_at
             FROM platform.agent_approval_requests
            WHERE tenant_id = $1::uuid
            ORDER BY created_at DESC
            LIMIT 50`,
          [context.tenantId],
        ),
      ]);
      return {
        missions: missionsRes.rows,
        tasks: tasksRes.rows,
        approvals: approvalsRes.rows,
      };
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json(
      { code: 'MISSIONS_UNAVAILABLE', message: 'Agent missions could not be loaded.' },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const intent = typeof body.intent === 'string' ? body.intent.trim() : '';

    if (!intent) {
      return NextResponse.json({ error: 'INTENT_REQUIRED' }, { status: 400 });
    }

    const authorizationPort: AgentToolAuthorizationPort = {
      async authorize(query: AgentToolAuthorizationQuery) {
        const decisionId = randomUUID();
        if (query.tenantId !== context.tenantId) {
          return { decisionId, allowed: false, reasonKey: 'TENANT_MISMATCH' };
        }
        if (query.effect === 'PROPOSE') {
          return { decisionId, allowed: false, reasonKey: 'PROPOSE_REQUIRES_POLICY' };
        }
        return { decisionId, allowed: true, reasonKey: 'TENANT_SCOPED_OBSERVE_ALLOWED' };
      },
    };

    const contextObserveTool: AgentToolAdapter = {
      toolKey: 'cbos.context.observe',
      effect: 'OBSERVE',
      async invoke(input: AgentToolAdapterInput) {
        return {
          executionId: input.executionId,
          tenantId: input.tenantId,
          toolKey: 'cbos.context.observe',
          kind: 'OBSERVATION',
          outputReference: `artifact:cbos:context:${input.tenantId}:${input.executionId}`,
          sourceReferences: [input.contextBundleReference],
          producedAt: new Date().toISOString(),
        };
      },
    };

    const orchestrator = new ChiefOfStaffOrchestrator({
      executorOptions: { authorizationPort, registeredTools: [contextObserveTool] },
    });

    const mission = await withBrandTransaction(context, async (client) => {
      const repository = new PostgresChiefOfStaffRepository(client);
      return orchestrator.processExecutiveIntent(
        repository,
        {
          tenantId: context.tenantId,
          userSubjectId: context.subjectId,
          intent,
        },
        () => {},
      );
    });

    return NextResponse.json({ missionId: mission.missionId, status: mission.status });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    return NextResponse.json({ error }, { status: 500 });
  }
}
