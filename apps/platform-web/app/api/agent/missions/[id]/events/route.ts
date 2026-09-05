import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 3000;
const MAX_DURATION_MS = 55_000;

interface MissionSnapshot {
  mission: Record<string, unknown> | null;
  tasks: readonly Record<string, unknown>[];
  approvals: readonly Record<string, unknown>[];
}

async function fetchSnapshot(
  request: Request,
  missionId: string,
  tenantId: string,
): Promise<MissionSnapshot> {
  const context = await resolveRequestContext(request);
  return withTenantClient(context, async (client) => {
    const [mRow, tRows, aRows] = await Promise.all([
      client.query(
        `SELECT mission_id, intent, status, summary, created_at, updated_at
           FROM platform.agent_missions
          WHERE mission_id = $1 AND tenant_id = $2::uuid`,
        [missionId, tenantId],
      ),
      client.query(
        `SELECT task_id, mission_id, assigned_agent_id, title, status, error, started_at, completed_at, created_at
           FROM platform.agent_tasks
          WHERE mission_id = $1 AND tenant_id = $2::uuid
          ORDER BY created_at`,
        [missionId, tenantId],
      ),
      client.query(
        `SELECT approval_id, task_id, title, status, created_at, resolved_at
           FROM platform.agent_approval_requests
          WHERE mission_id = $1 AND tenant_id = $2::uuid
          ORDER BY created_at`,
        [missionId, tenantId],
      ),
    ]);
    return {
      mission: mRow.rows[0] ?? null,
      tasks: tRows.rows,
      approvals: aRows.rows,
    };
  });
}

function snapshotHash(snap: MissionSnapshot): string {
  return JSON.stringify({
    status: snap.mission?.status,
    tasks: snap.tasks.map((t) => ({ id: t.task_id, status: t.status, error: t.error })),
    approvals: snap.approvals.map((a) => ({ id: a.approval_id, status: a.status })),
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let context;
  try {
    context = await resolveRequestContext(request);
  } catch {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id: missionId } = await params;
  const tenantId = context.tenantId;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const deadline = Date.now() + MAX_DURATION_MS;
      let lastHash = '';

      send('connected', { missionId });

      while (Date.now() < deadline) {
        try {
          const snap = await fetchSnapshot(request, missionId, tenantId);
          if (snap.mission === null) {
            send('error', { code: 'MISSION_NOT_FOUND' });
            break;
          }

          const hash = snapshotHash(snap);
          if (hash !== lastHash) {
            send('snapshot', snap);
            lastHash = hash;

            const terminal = snap.mission.status === 'COMPLETED' || snap.mission.status === 'FAILED';
            if (terminal) {
              send('done', { status: snap.mission.status });
              break;
            }
          }
        } catch {
          send('error', { code: 'FETCH_FAILED' });
          break;
        }

        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
