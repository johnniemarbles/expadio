import { NextResponse } from 'next/server';
import { deniedResponse, resolveRequestContext, withTenantTransaction } from '@/lib/request-context';
import { linkTelegramUser } from '@expadio/postgres-runtime/telegram-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Links the signed-in subject's account to a Telegram user id, so approval
 * cards can be delivered to them and their inline-button taps can be
 * attributed back to them. The caller proves who they are via their normal
 * EXPADIO session (resolveRequestContext); the Telegram user id itself comes
 * from the user pasting the numeric id Telegram's own /start reply shows
 * them, which requires no bot command parsing on our side.
 */
export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const telegramUserId = typeof body.telegramUserId === 'number' ? body.telegramUserId : null;

    if (telegramUserId === null || !Number.isInteger(telegramUserId) || telegramUserId <= 0) {
      return NextResponse.json({ error: 'TELEGRAM_USER_ID_REQUIRED' }, { status: 400 });
    }

    await withTenantTransaction(context, async (client) => {
      await linkTelegramUser(client, {
        telegramUserId,
        tenantId: context.tenantId,
        subjectId: context.subjectId,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { body, status } = deniedResponse(err);
    return NextResponse.json(body, { status });
  }
}
