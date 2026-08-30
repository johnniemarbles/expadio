import { NextResponse } from 'next/server';
import {
  resolveRequestContext,
  withTenantClient,
  deniedResponse,
} from '../../../../../lib/request-context';
import {
  DentexTreatmentProjectionError,
  loadDentexTreatmentWorkspace,
} from '../../../../../lib/dentex-treatment-projection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Product-facing DENTEX Treatment workspace read API.
 *
 * This endpoint does not own Treatment state. It composes the existing CRM,
 * Relationship Fabric, Decision Fabric, and Agreement authorities into one
 * typed read model for the DENTEX experience.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const treatmentId = decodeURIComponent((await params).id);

    const workspace = await withTenantClient(context, async (client) =>
      loadDentexTreatmentWorkspace(client, {
        tenantId: context.tenantId,
        treatmentId,
      }),
    );

    if (workspace === null) {
      return NextResponse.json(
        { error: 'That Treatment was not found in this workspace.' },
        { status: 404 },
      );
    }

    return NextResponse.json(workspace);
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
