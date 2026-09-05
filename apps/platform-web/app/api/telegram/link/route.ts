import { NextResponse } from 'next/server';
import { deniedResponse, resolveRequestContext, withTenantTransaction } from '@/lib/request-context';
import { getTelegramUserLink, linkTelegramUser, unlinkTelegramUser } from '@expadio/postgres-runtime/telegram-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const link = await withTenantTransaction(context, async (client) => {
      return getTelegramUserLink(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
      });
    });

    return NextResponse.json({ telegramUserId: link?.telegramUserId ?? null });
  } catch (err) {
    const { body, status } = deniedResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    let telegramUserId: number | null = null;
    if (typeof body.telegramUserId === 'number') {
      telegramUserId = body.telegramUserId;
    } else if (typeof body.telegramUserId === 'string' && /^\d+$/.test(body.telegramUserId.trim())) {
      telegramUserId = parseInt(body.telegramUserId.trim(), 10);
    }

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

    return NextResponse.json({ ok: true, telegramUserId });
  } catch (err) {
    const { body, status } = deniedResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    await withTenantTransaction(context, async (client) => {
      await unlinkTelegramUser(client, {
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
