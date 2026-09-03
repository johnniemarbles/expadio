import { NextResponse } from 'next/server';
import { deniedResponse, resolveRequestContext, withTenantTransaction } from '../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json() as { brandDisplayName?: unknown; idempotencyKey?: unknown };
    const name = typeof body.brandDisplayName === 'string' ? body.brandDisplayName.trim() : '';
    const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : null;
    if (name.length < 1 || name.length > 255 || (key !== null && !UUID.test(key))) {
      return NextResponse.json({ error: 'INVALID_GENESIS_REQUEST' }, { status: 400 });
    }
    const result = await withTenantTransaction(context, async (client) => {
      const query = await client.query<{
        claim_id: string; bootstrap_state: string; root_entity_id: string; already_existed: boolean;
      }>(
        'SELECT * FROM platform.bootstrap_tenant_genesis($1::uuid,$2,$3,$4::uuid)',
        [context.tenantId, context.subjectId, name, key],
      );
      return query.rows[0]!;
    });
    return NextResponse.json({
      success: true,
      claimId: result.claim_id,
      bootstrapState: result.bootstrap_state,
      rootEntityId: result.root_entity_id,
      alreadyExisted: result.already_existed,
    }, { status: result.already_existed ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    for (const code of ['ALREADY_BOOTSTRAPPED','GENESIS_CLAIMED','GENESIS_EXPIRED'] as const) {
      if (message.includes(code)) return NextResponse.json({ error: code }, { status: 409 });
    }
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
