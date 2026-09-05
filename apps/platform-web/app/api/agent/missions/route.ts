import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { deniedResponse, resolveRequestContext, withTenantTransaction } from '@/lib/request-context';
import {
  ChiefOfStaffOrchestrator,
  type AgentToolAuthorizationPort,
  type AgentToolAdapter,
} from '@expadio/agent-runtime';
import { PostgresChiefOfStaffRepository } from '@expadio/postgres-runtime/chief-of-staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const result = await withTenantTransaction(context, async (client) => {
      const missionsRes = await client.query(
        `SELECT mission_id, tenant_id, user_subject_id, intent, status, summary, created_at, updated_at
           FROM platform.agent_missions
          WHERE tenant_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 50`,
        [context.tenantId],
      );

      const tasksRes = await client.query(
        `SELECT task_id, mission_id, tenant_id, assigned_agent_id, title, description,
                action_payload, depends_on, requires_approval, status, output_artifact,
                error, started_at, completed_at, created_at
           FROM platform.agent_tasks
          WHERE tenant_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 100`,
        [context.tenantId],
      );

      const approvalsRes = await client.query(
        `SELECT approval_id, mission_id, task_id, tenant_id, title, description,
                staged_changes, status, telegram_message_id, created_at, resolved_at
           FROM platform.agent_approval_requests
          WHERE tenant_id = $1::uuid
          ORDER BY created_at DESC
          LIMIT 50`,
        [context.tenantId],
      );

      return {
        missions: missionsRes.rows,
        tasks: tasksRes.rows,
        approvals: approvalsRes.rows,
      };
    });

    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    const { body, status } = deniedResponse(err);
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const intent = typeof body.intent === 'string' ? body.intent.trim() : '';
    const taskPlans = Array.isArray(body.taskPlans) ? (body.taskPlans as any[]) : undefined;

    if (!intent) {
      return NextResponse.json({ error: 'INTENT_REQUIRED' }, { status: 400 });
    }

    const authorizationPort: AgentToolAuthorizationPort = {
      async authorize(query) {
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
      async invoke(input) {
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

        const createStubTool = (toolKey: string): AgentToolAdapter => ({
      toolKey,
      effect: 'OBSERVE',
      async invoke(input) {
        return {
          executionId: input.executionId,
          tenantId: input.tenantId,
          toolKey,
          kind: 'OBSERVATION',
          outputReference: `artifact:stub:${toolKey}:${input.tenantId}:${input.executionId}`,
          sourceReferences: [],
          producedAt: new Date().toISOString(),
        };
      },
    });

    const registeredTools = [
      contextObserveTool,
      createStubTool('content.editorial.debate'),
      createStubTool('revenue.lead.osint'),
      createStubTool('revenue.outreach.draft_sequence'),
      createStubTool('voice.callback.prepare'),
    ];

    const orchestrator = new ChiefOfStaffOrchestrator({
      executorOptions: { authorizationPort, registeredTools },
    });

    const mission = await withTenantTransaction(context, async (client) => {
      const repository = new PostgresChiefOfStaffRepository(client);
      return orchestrator.processExecutiveIntent(
        repository,
        {
          tenantId: context.tenantId,
          userSubjectId: context.subjectId,
          intent,
          taskPlans,
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
