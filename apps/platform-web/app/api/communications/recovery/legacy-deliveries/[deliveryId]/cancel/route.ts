import { NextResponse } from 'next/server';
import {
  deniedResponse,
  requireStepUp,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../../../../lib/request-context';
import {
  hasGovernanceWriteRole,
  resolveGoverningRole,
} from '../../../../../../../lib/governance-authz';
import { cancelLegacyCommunicationDelivery } from '../../../../../../../lib/communication-legacy-delivery-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ deliveryId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    await requireStepUp();

    const deliveryId = decodeURIComponent((await params).deliveryId);
    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason === '' || reason.length > 1000) {
      return NextResponse.json(
        { error: 'A recovery reason between 1 and 1000 characters is required.' },
        { status: 400 },
      );
    }

    const correlationId = crypto.randomUUID();
    const result = await withTenantTransaction(context, async (client) => {
      const allowed = await hasGovernanceWriteRole(client, context.subjectId);
      if (!allowed) throw new Error('COMMUNICATION_RECOVERY_FORBIDDEN');
      const roleKey = await resolveGoverningRole(client, context.subjectId);
      if (roleKey === null) throw new Error('COMMUNICATION_RECOVERY_FORBIDDEN');

      return cancelLegacyCommunicationDelivery(client, {
        tenantId: context.tenantId,
        deliveryId,
        actorSubjectId: context.subjectId,
        actorRoleKey: roleKey,
        reason,
        correlationId,
      });
    });

    return NextResponse.json({ success: true, correlationId, ...result });
  } catch (error) {
    const known = error as Error;
    if (known.message === 'COMMUNICATION_RECOVERY_FORBIDDEN') {
      return NextResponse.json(
        {
          error: 'A tenant or platform governance administrator role is required.',
          reasonKey: 'COMMUNICATION_RECOVERY_FORBIDDEN',
        },
        { status: 403 },
      );
    }
    if (known.message === 'LEGACY_DELIVERY_NOT_FOUND') {
      return NextResponse.json({ error: 'That legacy delivery was not found.' }, { status: 404 });
    }
    if (known.message === 'LEGACY_DELIVERY_NOT_RECOVERABLE') {
      return NextResponse.json(
        { error: 'That delivery is no longer a legacy PENDING delivery requiring recovery.' },
        { status: 409 },
      );
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
