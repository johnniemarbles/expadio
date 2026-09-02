import { NextResponse } from 'next/server';
import { listMyAvailableAssessments } from '@expadio/postgres-runtime/learning-assessment';
import { resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const assessments = await withBrandTransaction(context, (client) =>
      listMyAvailableAssessments(client, {
        tenantId: context.tenantId,
        subjectId: context.subjectId,
        subjectIssuer: context.issuer,
      }),
    );
    return NextResponse.json({ assessments }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'LEARNING_ASSESSMENTS_READ_FAILED';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_LEARNER_NOT_FOUND' ? 404 : 400 });
  }
}
