import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import {
  isGovernedRecoveryCommandStatus,
  isGovernedRecoveryCommandType,
  isGovernedRecoveryTargetKind,
  listGovernedRecoveryCommands,
} from '../../../../lib/governed-recovery-commands';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function singleParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value === undefined || value === null || value === '' ? undefined : value;
}

function integerParam(searchParams: URLSearchParams, key: string): number | undefined {
  const value = singleParam(searchParams, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Tenant-scoped governed recovery command queue.
 *
 * This is a bounded read-only operations API over platform.governed_recovery_commands.
 * It lists authorized recovery intents only and never executes retry, cancel,
 * mark-resolved, escalation, claim, or provider-side behavior.
 */
export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const { searchParams } = new URL(request.url);

    const status = singleParam(searchParams, 'status');
    const commandType = singleParam(searchParams, 'commandType');
    const targetKind = singleParam(searchParams, 'targetKind');
    const correlationId = singleParam(searchParams, 'correlationId');
    const limit = integerParam(searchParams, 'limit');

    if (status !== undefined && !isGovernedRecoveryCommandStatus(status)) {
      return NextResponse.json(
        { error: 'Unsupported governed recovery command status.' },
        { status: 400 },
      );
    }

    if (commandType !== undefined && !isGovernedRecoveryCommandType(commandType)) {
      return NextResponse.json(
        { error: 'Unsupported governed recovery command type.' },
        { status: 400 },
      );
    }

    if (targetKind !== undefined && !isGovernedRecoveryTargetKind(targetKind)) {
      return NextResponse.json(
        { error: 'Unsupported governed recovery target kind.' },
        { status: 400 },
      );
    }

    const entries = await withTenantClient(context, async (client) => listGovernedRecoveryCommands(client, {
      tenantId: context.tenantId,
      ...(status === undefined ? {} : { status }),
      ...(commandType === undefined ? {} : { commandType }),
      ...(targetKind === undefined ? {} : { targetKind }),
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(limit === undefined ? {} : { limit }),
    }));

    return NextResponse.json({ entries });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
