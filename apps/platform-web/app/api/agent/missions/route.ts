import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantTransaction } from '@/lib/request-context';
import { ChiefOfStaffOrchestrator, type AgentToolAuthorizationPort } from '@expadio/agent-runtime';
import { PostgresChiefOfStaffRepository } from '@expadio/postgres-runtime/chief-of-staff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const intent = typeof body.intent === 'string' ? body.intent.trim() : '';

    if (!intent) {
      return NextResponse.json({ error: 'INTENT_REQUIRED' }, { status: 400 });
    }

    const authorizationPort: AgentToolAuthorizationPort = {
      async authorize() {
        return { decisionId: 'dec-1', allowed: true, reasonKey: 'AUTHORIZED' };
      },
    };

    const orchestrator = new ChiefOfStaffOrchestrator({
      executorOptions: { authorizationPort },
    });

    const mission = await withTenantTransaction(context, async (client) => {
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
