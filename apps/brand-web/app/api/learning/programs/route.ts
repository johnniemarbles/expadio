import { NextResponse } from 'next/server';
import {
  createLearningProgram,
  listLearningPrograms,
} from '@expadio/postgres-runtime/learning-program-certification';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const result = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return listLearningPrograms(client, context.tenantId);
    });
    return NextResponse.json({ programs: result }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_PROGRAMS_READ_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'PROGRAM_BODY_INVALID' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    const program = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return createLearningProgram(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        programKey: body.programKey,
        draft: body.draft,
      });
    });
    return NextResponse.json(program, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_PROGRAM_CREATE_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
