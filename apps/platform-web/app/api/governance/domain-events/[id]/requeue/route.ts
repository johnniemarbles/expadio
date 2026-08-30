import { NextResponse } from 'next/server';
import {
  deniedResponse,
  requireStepUp,
  stepUpReverificationResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../../../lib/request-context';
import {
  hasGovernanceWriteRole,
  resolveGoverningRole,
} from '../../../../../../lib/governance-authz';
import {
  requeueDeadDomainEvent,
} from '../../../../../../lib/domain-event-operations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    await requireStepUp();

    const outboxId = decodeURIComponent((await params).id);
    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason === '' || reason.length > 1000) {
      return NextResponse.json(
        { error: 'A requeue reason between 1 and 1000 characters is required.' },
        { status: 400 },
      );
    }

    const correlationId = crypto.randomUUID();

    const result = await withTenantTransaction(context, async (client) => {
      const allowed = await hasGovernanceWriteRole(client, context.subjectId);
      if (!allowed) throw new Error('GOVERNANCE_WRITE_FORBIDDEN');

      const roleKey = await resolveGoverningRole(client, context.subjectId);
      if (roleKey === null) throw new Error('GOVERNANCE_WRITE_FORBIDDEN');

      return requeueDeadDomainEvent(client, {
        tenantId: context.tenantId,
        outboxId,
        actorSubjectId: context.subjectId,
        actorRoleKey: roleKey,
        reason,
        correlationId,
      });
    });

    return NextResponse.json({
      success: true,
      correlationId,
      ...result,
    });
  } catch (error) {
    const reverification = stepUpReverificationResponse(error);
    if (reverification !== null) return reverification;
    const known = error as Error;
    if (known.message === 'GOVERNANCE_WRITE_FORBIDDEN') {
      return NextResponse.json(
        {
          error: 'A tenant or platform governance administrator role is required.',
          reasonKey: 'GOVERNANCE_WRITE_FORBIDDEN',
        },
        { status: 403 },
      );
    }
    if (known.message === 'DOMAIN_EVENT_OUTBOX_NOT_FOUND') {
      return NextResponse.json(
        { error: 'That Domain Event outbox item was not found.' },
        { status: 404 },
      );
    }
    if (known.message === 'DOMAIN_EVENT_OUTBOX_NOT_DEAD') {
      return NextResponse.json(
        { error: 'Only terminal DEAD outbox items can be manually requeued.' },
        { status: 409 },
      );
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
