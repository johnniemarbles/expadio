import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { deniedResponse, resolveRequestContext, withTenantTransaction } from '@/lib/request-context';
import {
  ChiefOfStaffOrchestrator,
  createMissionAuthorizationPort,
  getRegisteredMissionTools,
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

      // Calculate ready agents count: active platform capabilities + active equipped persona agents
      const readyRes = await client.query(
        `WITH ready_personas AS (
           SELECT a.agent_id, a.slug, a.persona as name
           FROM platform.tenant_agent_bindings b
           JOIN platform.agent_definitions a ON a.agent_id = b.agent_id
           WHERE b.tenant_id = $1::text AND b.status = 'ACTIVE'
             AND (
               jsonb_array_length(a.tools) = 0 
               OR NOT EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(a.tools) AS tool
                 LEFT JOIN platform.tenant_tool_grants g 
                   ON g.tool_group = tool AND g.tenant_id = $1::text AND g.enabled = true
                 WHERE g.tool_group IS NULL
               )
             )
             AND (
               NOT (a.tools ? 'Comms')
               OR EXISTS (
                 SELECT 1 FROM platform.connectors c
                 WHERE (c.tenant_id IS NULL OR c.tenant_id = $1::uuid)
                   AND c.enabled = true
                   AND c.health = 'HEALTHY'
                   AND c.provider_type IN ('email','sms','whatsapp','voice','push','rcs')
               )
             )
         ),
         ready_capabilities AS (
           SELECT c.capability_id, c.capability_key as slug, c.display_name as name
           FROM platform.tenant_capability_bindings b
           JOIN platform.capabilities c ON b.capability_id = c.capability_id
           JOIN platform.capability_state s ON s.binding_id = b.binding_id
           WHERE b.tenant_id = $1::uuid AND s.state = 'ACTIVE'
         )
         SELECT slug, name FROM ready_personas 
         UNION ALL 
         SELECT slug, name FROM ready_capabilities`,
        [context.tenantId]
      );

      return {
        missions: missionsRes.rows,
        tasks: tasksRes.rows,
        approvals: approvalsRes.rows,
        readyAgentCount: readyRes.rows.length,
        readyAgents: readyRes.rows.map(r => ({ slug: r.slug, name: r.name })),
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

    const authorizationPort = createMissionAuthorizationPort(context.tenantId);
    const registeredTools = getRegisteredMissionTools();

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
