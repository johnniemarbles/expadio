import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { publishLearningCertificationVersion } from '@expadio/postgres-runtime/learning-program-certification';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../../../../lib/brand-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  try {
    const context = await resolveBrandContext();
    const raw = await params;
    const certificationId = decodeURIComponent(raw.id);
    const version = Number(decodeURIComponent(raw.version));
    if (!UUID.test(certificationId) || !Number.isInteger(version) || version <= 0) {
      return NextResponse.json({ error: 'CERTIFICATION_VERSION_INVALID' }, { status: 400 });
    }
    const published = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return publishLearningCertificationVersion(client, {
        tenantId: context.tenantId,
        certificationId,
        version,
        actorSubjectId: context.subjectId,
        correlationId: randomUUID(),
      });
    });
    return NextResponse.json(published, { status: published.idempotent ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_CERTIFICATION_PUBLISH_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
