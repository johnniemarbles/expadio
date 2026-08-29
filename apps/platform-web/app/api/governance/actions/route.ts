import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../lib/crm-authz';
import { availableActions, decideOnSubject, assignOnSubject } from '../../../../lib/governance-actions';

const TARGET_KINDS = new Set([
  'USER', 'ROLE', 'PERSONA', 'TEAM', 'QUEUE', 'ORGANIZATION', 'TERRITORY', 'EXTERNAL_PARTY', 'SYSTEM', 'AI_AGENT',
]);

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

/**
 * Take a governed action on a subject from the review queue, across any vertical:
 * DECIDE (record an immutable decision on the current stage) or ASSIGN (fill a
 * participant slot). Writes require a governing role; DECIDE is additionally
 * gated by separation of duties and any authority deriver the work type
 * registered, inside recordCaseDecision. RLS keeps everything within the tenant.
 */
export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();
    const workTypeKey = typeof body?.workType === 'string' ? body.workType.trim() : '';
    const subjectId = typeof body?.subject === 'string' ? body.subject.trim() : '';
    const action = typeof body?.action === 'string' ? body.action.trim().toUpperCase() : '';
    if (workTypeKey === '' || subjectId === '') {
      return NextResponse.json({ error: 'A work type and subject are required.' }, { status: 400 });
    }
    if (action !== 'DECIDE' && action !== 'ASSIGN') {
      return NextResponse.json({ error: 'Action must be DECIDE or ASSIGN.' }, { status: 400 });
    }

    const outcome = typeof body?.outcome === 'string' ? body.outcome.trim() : '';
    const stageKey = typeof body?.stageKey === 'string' ? body.stageKey.trim() : '';
    const participantKey = typeof body?.participantKey === 'string' ? body.participantKey.trim() : '';
    if (action === 'DECIDE' && outcome === '') {
      return NextResponse.json({ error: 'A decision outcome is required.' }, { status: 400 });
    }
    if (action === 'ASSIGN' && (stageKey === '' || participantKey === '')) {
      return NextResponse.json({ error: 'A stage and participant slot are required.' }, { status: 400 });
    }
    const targetKind = typeof body?.targetKind === 'string' && TARGET_KINDS.has(body.targetKind) ? body.targetKind : 'USER';
    const targetKey = typeof body?.targetKey === 'string' && body.targetKey.trim() !== '' ? body.targetKey.trim() : context.subjectId;

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      if (action === 'DECIDE') {
        const decided = await decideOnSubject(client, { tenantId: context.tenantId, workTypeKey, subjectId, outcome, approverSubjectId: context.subjectId });
        return { kind: 'DECIDE', decided } as const;
      }
      const assigned = await assignOnSubject(client, {
        tenantId: context.tenantId, workTypeKey, subjectId, stageKey, participantKey, targetKind, targetKey, assignedBySubjectId: context.subjectId,
      });
      return { kind: 'ASSIGN', assigned } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to act on governed work.' }, { status: 403 });
    }

    if (result.kind === 'DECIDE') {
      const decided = result.decided;
      if (!decided.ok) {
        if (decided.reason === 'AUTHORITY_DENIED') {
          return NextResponse.json({ error: decided.message, code: decided.code }, { status: 403 });
        }
        if (decided.reason === 'CONFLICT') {
          return NextResponse.json(
            { error: `This stage already has a different decision recorded (${decided.existingOutcome}). Decisions are immutable.` },
            { status: 409 },
          );
        }
        // NO_WORKFLOW | NO_STAGE
        return NextResponse.json({ error: 'No workflow stage is awaiting a decision for that subject.' }, { status: 409 });
      }
      return NextResponse.json({ success: true, action: 'DECIDE', status: decided.status, outcome: decided.outcome }, { status: 201 });
    }

    const assigned = result.assigned;
    if (!assigned.ok) {
      return NextResponse.json({ error: 'No workflow was found for that subject.' }, { status: 409 });
    }
    return NextResponse.json({
      success: true,
      action: 'ASSIGN',
      stageKey,
      participantKey,
      status: assigned.assigned.ok ? assigned.assigned.status : 'ASSIGNED',
    }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
