import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { dbPool } from '../../../../lib/iam-adapter';
import { deniedResponse } from '../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const result = await dbPool.query(
      `SELECT agent_id, department, slug, persona, tools, default_on, status, created_at, updated_at
         FROM platform.agent_definitions
        ORDER BY department, persona`
    );
    return NextResponse.json(result.rows, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err: any) {
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const body = await request.json();
    const { department, slug, persona, tools, default_on } = body;

    if (!department || !slug || !persona) {
      return NextResponse.json({ error: 'department, slug, and persona are required' }, { status: 400 });
    }

    const toolsJson = Array.isArray(tools) ? tools : [];

    const result = await dbPool.query(
      `INSERT INTO platform.agent_definitions (department, slug, persona, tools, default_on, status)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'ACTIVE')
       RETURNING *`,
      [department, slug, persona, JSON.stringify(toolsJson), !!default_on]
    );

    return NextResponse.json(result.rows[0]);
  } catch (err: any) {
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}
