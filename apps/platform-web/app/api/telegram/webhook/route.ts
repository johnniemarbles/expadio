import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  ChiefOfStaffOrchestrator,
  handleTelegramCallbackQuery,
  type AgentToolAuthorizationPort,
} from '@expadio/agent-runtime';
import { PostgresChiefOfStaffRepository } from '@expadio/postgres-runtime/chief-of-staff';
import { PostgresTelegramLinkResolver } from '@expadio/postgres-runtime/telegram-links';
import { dbPool } from '@/lib/iam-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TelegramUpdate {
  readonly callback_query?: {
    readonly id: string;
    readonly data?: string;
    readonly from?: { readonly id?: number };
  };
}

/**
 * Telegram approval channel webhook.
 *
 * Trust boundary, mirroring apps/platform-web/app/api/webhooks/resend/route.ts:
 * - No Clerk/user session is accepted here -- Telegram calls this endpoint
 *   directly, authenticated only by the shared secret token below.
 * - Tenant context is resolved from platform.telegram_user_links (no RLS,
 *   see migration 0173) rather than from a request header, since the caller
 *   has no session to derive one from.
 * - Approval resolution always goes through
 *   ChiefOfStaffOrchestrator.resolveApproval() -- the same path
 *   apps/platform-web/app/api/agent/missions/[id]/approve/route.ts uses --
 *   so the Phase 0 self-approval guard applies identically here.
 * - Always responds 200 once the secret is verified, per Telegram's webhook
 *   contract (a non-2xx response causes Telegram to retry indefinitely).
 */
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret === undefined || secret.trim() === '') {
    return NextResponse.json({ error: 'Telegram webhook secret is not configured.' }, { status: 503 });
  }
  if (request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const callback = update?.callback_query;
  if (!callback || typeof callback.data !== 'string' || typeof callback.from?.id !== 'number') {
    // Not a callback_query update (e.g. a plain text message) -- acknowledge
    // and ignore, per Telegram's webhook contract.
    return NextResponse.json({ ok: true });
  }
  const telegramUserId = callback.from.id;
  const callbackData = callback.data;

  const client = await dbPool.connect();
  try {
    const result = await handleTelegramCallbackQuery(
      { callbackQueryId: callback.id, telegramUserId, data: callbackData },
      {
        linkResolver: new PostgresTelegramLinkResolver(client),
        approvalPort: {
          async resolve(input) {
            await client.query('BEGIN');
            try {
              await client.query("SELECT set_config('app.tenant_id', $1, true)", [input.tenantId]);
              await client.query("SELECT set_config('app.subject_id', $1, true)", [input.approverSubjectId]);

              const authorizationPort: AgentToolAuthorizationPort = {
                async authorize(query) {
                  const decisionId = randomUUID();
                  return query.tenantId === input.tenantId && query.effect === 'OBSERVE'
                    ? { decisionId, allowed: true, reasonKey: 'TENANT_SCOPED_OBSERVE_ALLOWED' }
                    : { decisionId, allowed: false, reasonKey: 'PROPOSE_REQUIRES_POLICY' };
                },
              };
              const orchestrator = new ChiefOfStaffOrchestrator({ executorOptions: { authorizationPort } });

              const status = await orchestrator.resolveApproval(
                new PostgresChiefOfStaffRepository(client),
                {
                  approvalId: input.approvalId,
                  missionId: input.missionId,
                  tenantId: input.tenantId,
                  approved: input.approved,
                  approverSubjectId: input.approverSubjectId,
                },
                () => {},
              );

              await client.query('COMMIT');
              return status;
            } catch (err) {
              await client.query('ROLLBACK');
              throw err;
            }
          },
        },
      },
    );

    return NextResponse.json({ ok: true, outcome: result.outcome });
  } catch {
    // Still acknowledge with 200 -- an internal failure here must not cause
    // Telegram to retry-storm this webhook. The outcome is logged server-side
    // by whatever request logging wraps this route; nothing further to
    // recover client-side from a webhook caller with no session to respond to.
    return NextResponse.json({ ok: true, outcome: 'ERROR' });
  } finally {
    await client.query('RESET app.tenant_id').catch(() => undefined);
    await client.query('RESET app.subject_id').catch(() => undefined);
    client.release();
  }
}
