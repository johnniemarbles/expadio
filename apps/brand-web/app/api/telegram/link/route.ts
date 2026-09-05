import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { resolveBrandContext, withBrandTransaction } from '@/lib/brand-context';
import { getTelegramUserLink, linkTelegramUser, unlinkTelegramUser } from '@expadio/postgres-runtime/telegram-links';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const link = await withBrandTransaction(context, async (client: PoolClient) => {
      return getTelegramUserLink(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
      });
    });

    return NextResponse.json(
      { telegramUserId: link?.telegramUserId ?? null },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    const status = msg === 'UNAUTHENTICATED' ? 401 : msg === 'NO_BRAND_MEMBERSHIP' ? 403 : 500;
    return NextResponse.json({ error: msg }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    let telegramUserId: number | null = null;
    if (typeof body.telegramUserId === 'number') {
      telegramUserId = body.telegramUserId;
    } else if (typeof body.telegramUserId === 'string' && /^\d+$/.test(body.telegramUserId.trim())) {
      telegramUserId = parseInt(body.telegramUserId.trim(), 10);
    }

    if (telegramUserId === null || !Number.isInteger(telegramUserId) || telegramUserId <= 0) {
      return NextResponse.json(
        { error: 'TELEGRAM_USER_ID_REQUIRED' },
        { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    await withBrandTransaction(context, async (client: PoolClient) => {
      await linkTelegramUser(client, {
        telegramUserId,
        tenantId: context.tenantId,
        subjectId: context.subjectId,
      });
    });

    return NextResponse.json(
      { ok: true, telegramUserId },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    const status = msg === 'UNAUTHENTICATED' ? 401 : msg === 'NO_BRAND_MEMBERSHIP' ? 403 : 500;
    return NextResponse.json({ error: msg }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export async function DELETE() {
  try {
    const context = await resolveBrandContext();
    await withBrandTransaction(context, async (client: PoolClient) => {
      await unlinkTelegramUser(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
      });
    });

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'INTERNAL_ERROR';
    const status = msg === 'UNAUTHENTICATED' ? 401 : msg === 'NO_BRAND_MEMBERSHIP' ? 403 : 500;
    return NextResponse.json({ error: msg }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
