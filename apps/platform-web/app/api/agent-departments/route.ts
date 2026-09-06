import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { dbPool } from '@/lib/iam-adapter';
import { deniedResponse } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const result = await dbPool.query(
      `SELECT name, description, created_at
         FROM platform.departments
        ORDER BY name`
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
    const { name, description } = body;

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const result = await dbPool.query(
      `INSERT INTO platform.departments (name, description)
       VALUES ($1, $2)
       RETURNING *`,
      [name, description || null]
    );

    return NextResponse.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') { // unique violation
      return NextResponse.json({ error: 'Department already exists' }, { status: 409 });
    }
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}
