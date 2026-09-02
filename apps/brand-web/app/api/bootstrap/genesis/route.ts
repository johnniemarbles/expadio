import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { dbPool } from '../../../../lib/brand-context';

const ISSUER = 'https://clerk.expadio.com';

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  const idempotencyKey = request.headers.get('idempotency-key')?.trim();
  if (!idempotencyKey) return NextResponse.json({ error: 'Idempotency-Key header is required.' }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const tenantName = typeof body.tenantName === 'string' ? body.tenantName.trim() : '';
    const organizationName = typeof body.organizationName === 'string' ? body.organizationName.trim() : '';
    if (!tenantName || !organizationName) {
      return NextResponse.json({ error: 'Tenant and organization names are required.' }, { status: 400 });
    }
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'SELECT * FROM platform.bootstrap_genesis_tenant($1,$2,$3,$4,$5)',
        [userId, ISSUER, tenantName, organizationName, idempotencyKey],
      );
      await client.query('COMMIT');
      return NextResponse.json(result.rows[0], { status: result.rows[0]?.idempotent ? 200 : 201 });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  } catch {
    return NextResponse.json({ error: 'GENESIS_BOOTSTRAP_FAILED' }, { status: 409 });
  }
}
