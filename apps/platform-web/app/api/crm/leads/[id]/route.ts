import { NextResponse } from 'next/server';
import { validateStage, LeadValidationError, type LeadStage } from '@expadio/lead';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../lib/crm-authz';
import { decideLeadTransition, leadTransitionEntryHash } from '../../../../../lib/crm-lead-transition';
import { toLead } from '../route';

/**
 * Move a lead through the pipeline (governed). RLS keeps the update within the
 * caller's selected organization subtree; a governing role is required. The move
 * must be a legal transition, may require a reason, honors an optional expected
 * revision (optimistic concurrency), and is recorded in a hash-chained audit.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function boundedReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 1000 || /[\0\r]/u.test(trimmed)) throw new Error('INVALID_REASON');
  return trimmed;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const leadId = decodeURIComponent((await params).id);
    const body = await request.json();

    let stage: LeadStage;
    let reason: string | null;
    try {
      stage = validateStage(body.stage);
      reason = boundedReason(body.reason);
    } catch (error) {
      if (error instanceof LeadValidationError) {
        return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
      }
      return NextResponse.json({ error: 'Transition reason is invalid.' }, { status: 400 });
    }
    const expectedRevision = Number.isInteger(body.expectedRevision) ? Number(body.expectedRevision) : null;

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const current = await client.query<{ organization_id: string; stage: LeadStage; revision: number }>(
        `SELECT organization_id, stage, revision FROM platform.crm_leads
          WHERE lead_id = $1::uuid FOR UPDATE`,
        [leadId],
      );
      const row = current.rows[0];
      if (!row) return { notFound: true } as const;

      // Same-stage is an idempotent no-op, not a transition.
      if (row.stage === stage) {
        const unchanged = await client.query(
          `SELECT lead_id, tenant_id, organization_id, account_id, contact_id, title, stage,
                  amount_minor_units, currency, source, raw_payload, owner_subject_id,
                  capture_lead_id, capture_layer_id, created_at, updated_at
             FROM platform.crm_leads WHERE lead_id = $1::uuid`,
          [leadId],
        );
        return { lead: toLead(unchanged.rows[0]), replayed: true } as const;
      }

      const decision = decideLeadTransition({
        from: row.stage,
        to: stage,
        reason,
        currentRevision: row.revision,
        expectedRevision,
      });
      if (!decision.ok) {
        return { denied: { reasonCode: decision.reasonCode!, message: decision.message! } } as const;
      }

      const toRevision = row.revision + 1;
      const occurredAt = new Date().toISOString();
      const updated = await client.query(
        `UPDATE platform.crm_leads
            SET stage = $2, revision = $3, updated_at = now()
          WHERE lead_id = $1::uuid AND revision = $4
          RETURNING lead_id, tenant_id, organization_id, account_id, contact_id, title, stage,
                    amount_minor_units, currency, source, raw_payload, owner_subject_id,
                    capture_lead_id, capture_layer_id, created_at, updated_at`,
        [leadId, stage, toRevision, row.revision],
      );
      if (updated.rows.length === 0) {
        // Lost the optimistic race between SELECT ... FOR UPDATE and UPDATE.
        return { denied: { reasonCode: 'REVISION_CONFLICT', message: 'This lead changed concurrently. Reload and try again.' } } as const;
      }
      const lead = updated.rows[0];

      const prev = await client.query<{ entry_hash: string }>(
        `SELECT entry_hash FROM platform.crm_lead_stage_transitions
          WHERE lead_id = $1::uuid ORDER BY to_revision DESC LIMIT 1`,
        [leadId],
      );
      const prevHash = prev.rows[0]?.entry_hash ?? null;
      const entryHash = leadTransitionEntryHash({
        prevHash, leadId, fromStage: row.stage, toStage: stage,
        transitionKind: decision.kind, reason, actorSubjectId: context.subjectId,
        toRevision, occurredAt,
      });
      await client.query(
        `INSERT INTO platform.crm_lead_stage_transitions
           (tenant_id, organization_id, lead_id, from_stage, to_stage, transition_kind,
            reason, actor_subject_id, from_revision, to_revision, prev_hash, entry_hash, occurred_at)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz)`,
        [lead.tenant_id, lead.organization_id, leadId, row.stage, stage, decision.kind,
         reason, context.subjectId, row.revision, toRevision, prevHash, entryHash, occurredAt],
      );

      return { lead: toLead(lead), revision: toRevision, transitionKind: decision.kind } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to move leads.' }, { status: 403 });
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'That lead was not found in this workspace.' }, { status: 404 });
    }
    if (result.denied) {
      const status = result.denied.reasonCode === 'REVISION_CONFLICT' ? 409 : 422;
      return NextResponse.json({ denied: true, reasonKey: result.denied.reasonCode, message: result.denied.message }, { status });
    }
    if ('replayed' in result) {
      return NextResponse.json({ success: true, replayed: true, lead: result.lead });
    }
    return NextResponse.json({ success: true, lead: result.lead, revision: result.revision, transitionKind: result.transitionKind });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
