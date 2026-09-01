import { NextResponse } from 'next/server';
import {
  loadLearningAiSettings,
  updateLearningAiSettings,
} from '@expadio/postgres-runtime/learning-ai';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { hasLearningAuthoringRole } from '@/lib/learning-authz';
import { learningApiError } from '@/lib/learning-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function authorizedSettings(request: Request, mutate?: boolean) {
  const context = await resolveRequestContext(request);
  return withTenantTransaction(context, async (client) => {
    if (!(await hasLearningAuthoringRole(client, context.subjectId))) {
      return { forbidden: true } as const;
    }
    if (!mutate) {
      return {
        settings: await loadLearningAiSettings(client, context.tenantId),
      } as const;
    }
    const raw = await request.json().catch(() => ({}));
    const body =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    if (typeof body.aiFeaturesEnabled !== 'boolean') {
      return { invalid: true } as const;
    }
    return {
      settings: await updateLearningAiSettings(client, {
        tenantId: context.tenantId,
        aiFeaturesEnabled: body.aiFeaturesEnabled,
      }),
    } as const;
  });
}

export async function GET(request: Request) {
  try {
    const result = await authorizedSettings(request);
    if ('forbidden' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'Learning AI settings require a tenant administrator role.',
        },
        { status: 403 },
      );
    }
    return NextResponse.json(result.settings, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const mapped = learningApiError(error);
    if (mapped !== null) {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const result = await authorizedSettings(request, true);
    if ('forbidden' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'Learning AI settings require a tenant administrator role.',
        },
        { status: 403 },
      );
    }
    if ('invalid' in result) {
      return NextResponse.json(
        {
          reasonKey: 'LEARNING_AI_SETTINGS_INVALID',
          message: 'aiFeaturesEnabled must be boolean.',
        },
        { status: 400 },
      );
    }
    return NextResponse.json(result.settings, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const mapped = learningApiError(error);
    if (mapped !== null) {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
