import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { dbPool } from '../../../../../lib/iam-adapter';
import { deniedResponse } from '../../../../../lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const { id } = params;
    const body = await request.json();
    const { department, slug, persona, tools, default_on, status } = body;

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (department !== undefined) { updates.push(`department = $${idx++}`); values.push(department); }
    if (slug !== undefined) { updates.push(`slug = $${idx++}`); values.push(slug); }
    if (persona !== undefined) { updates.push(`persona = $${idx++}`); values.push(persona); }
    if (tools !== undefined) { updates.push(`tools = $${idx++}::jsonb`); values.push(JSON.stringify(Array.isArray(tools) ? tools : [])); }
    if (default_on !== undefined) { updates.push(`default_on = $${idx++}`); values.push(!!default_on); }
    if (status !== undefined) { updates.push(`status = $${idx++}`); values.push(status); }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE platform.agent_definitions
      SET ${updates.join(', ')}
      WHERE agent_id = $${idx}
      RETURNING *
    `;

    const result = await dbPool.query(query, values);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err: any) {
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const { id } = params;

    const result = await dbPool.query(
      `DELETE FROM platform.agent_definitions WHERE agent_id = $1 RETURNING agent_id`,
      [id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted_id: result.rows[0].agent_id });
  } catch (err: any) {
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}
