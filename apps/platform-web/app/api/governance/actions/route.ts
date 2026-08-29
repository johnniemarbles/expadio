import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { availableActions } from '../../../../lib/governance-actions';

/**
 * The governed actions a caller can take on a subject right now, across any
 * vertical — the read half of cross-vertical actions, driving the review queue's
 * affordances. A membership read; RLS keeps it within the caller's tenant.
 * `workType` and `subject` identify the item (as the queue lists them).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const workTypeKey = url.searchParams.get('workType')?.trim() ?? '';
    const subjectId = url.searchParams.get('subject')?.trim() ?? '';
    if (workTypeKey === '' || subjectId === '') {
      return NextResponse.json({ error: 'A work type and subject are required.' }, { status: 400 });
    }
    const result = await withTenantClient(context, (client) =>
      availableActions(client, { tenantId: context.tenantId, workTypeKey, subjectId }),
    );
    if (result === null) {
      return NextResponse.json({ error: 'No workflow was found for that subject.' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
