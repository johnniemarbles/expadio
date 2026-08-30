import { NextResponse } from 'next/server';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantClient,
} from '../../../../../../lib/request-context';
import {
  DentexTreatmentProjectionError,
} from '../../../../../../lib/dentex-treatment-projection';
import {
  loadDentexTreatmentReadiness,
} from '../../../../../../lib/dentex-treatment-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const treatmentId = decodeURIComponent((await params).id);

    const readiness = await withTenantClient(context, async (client) =>
      loadDentexTreatmentReadiness(client, {
        tenantId: context.tenantId,
        treatmentId,
      }),
    );

    if (readiness === null) {
      return NextResponse.json(
        { error: 'That Treatment was not found in this workspace.' },
        { status: 404 },
      );
    }

    return NextResponse.json(readiness);
  } catch (error) {
    if (error instanceof DentexTreatmentProjectionError) {
      return NextResponse.json(
        { error: error.message, reasonKey: error.code },
        { status: 409 },
      );
    }
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
