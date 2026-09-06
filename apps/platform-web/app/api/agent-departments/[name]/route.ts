import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { dbPool } from '@/lib/iam-adapter';
import { deniedResponse } from '@/lib/request-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const { name: originalName } = await params;
    const body = await request.json();
    const { name: newName, description } = body;

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (newName !== undefined) { updates.push(`name = $${idx++}`); values.push(newName); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(decodeURIComponent(originalName));

    const query = `
      UPDATE platform.departments
      SET ${updates.join(', ')}
      WHERE name = $${idx}
      RETURNING *
    `;

    const result = await dbPool.query(query, values);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Department not found' }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') {
      return NextResponse.json({ error: 'Target department name already exists' }, { status: 409 });
    }
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ denied: true, reasonKey: 'UNAUTHENTICATED' }, { status: 401 });

  try {
    const { name } = await params;
    const decodedName = decodeURIComponent(name);

    const result = await dbPool.query(
      `DELETE FROM platform.departments WHERE name = $1 RETURNING name`,
      [decodedName]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'Department not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, deleted_name: result.rows[0].name });
  } catch (err: any) {
    if (err.code === '23503') { // foreign_key_violation
      return NextResponse.json({ error: 'Cannot delete department: Agents are still assigned to it.' }, { status: 409 });
    }
    const resp = deniedResponse(err);
    return NextResponse.json(resp.body, { status: resp.status });
  }
}
