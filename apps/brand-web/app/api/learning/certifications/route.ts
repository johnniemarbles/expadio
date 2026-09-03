import { NextResponse } from 'next/server';
import {
  createLearningCertification,
  listLearningCertifications,
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
    const certifications = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return listLearningCertifications(client, context.tenantId);
    });
    return NextResponse.json({ certifications }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_CERTIFICATIONS_READ_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const raw = await request.json().catch(() => null);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'CERTIFICATION_BODY_INVALID' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;
    const certification = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return createLearningCertification(client, {
        tenantId: context.tenantId,
        actorSubjectId: context.subjectId,
        certificationKey: body.certificationKey,
        draft: body.draft,
      });
    });
    return NextResponse.json(certification, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_CERTIFICATION_CREATE_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
