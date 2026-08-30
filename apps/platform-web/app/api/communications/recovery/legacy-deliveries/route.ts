import { NextResponse } from 'next/server';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../../lib/request-context';
import { listLegacyCommunicationDeliveries } from '../../../../../lib/communication-legacy-delivery-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get('limit') ?? 100);
    if (!Number.isInteger(rawLimit) || rawLimit <= 0) {
      return NextResponse.json({ error: 'limit must be a positive integer.' }, { status: 400 });
    }

    const items = await withTenantTransaction(context, (client) =>
      listLegacyCommunicationDeliveries(client, {
        tenantId: context.tenantId,
        limit: Math.min(rawLimit, 200),
      }),
    );

    return NextResponse.json({ items, count: items.length });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
