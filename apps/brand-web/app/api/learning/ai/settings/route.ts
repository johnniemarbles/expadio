import { NextResponse } from 'next/server';
import { updateLearningAiSettings } from '@expadio/postgres-runtime/learning-ai';
import {
  hasLearningAdmin,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../lib/brand-context';

export async function PATCH(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json().catch(() => null) as { aiFeaturesEnabled?: unknown } | null;
    if (typeof body?.aiFeaturesEnabled !== 'boolean') {
      return NextResponse.json({ error: 'AI_SETTING_INVALID' }, { status: 400 });
    }
    const value = await withBrandTransaction(context, async (client) => {
      if (!(await hasLearningAdmin(client, context.subjectId))) throw new Error('LEARNING_ADMIN_REQUIRED');
      return updateLearningAiSettings(client, {
        tenantId: context.tenantId,
        aiFeaturesEnabled: body.aiFeaturesEnabled as boolean,
      });
    });
    return NextResponse.json(value);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    return NextResponse.json({ error: code }, { status: code === 'LEARNING_ADMIN_REQUIRED' ? 403 : 400 });
  }
}
