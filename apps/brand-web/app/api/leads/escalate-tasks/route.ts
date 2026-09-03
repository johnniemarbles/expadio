import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

/**
 * SLA escalation sweep — stamps escalated_at on open tasks that have exceeded
 * their SLA escalation threshold without already being escalated.
 *
 * POST /api/leads/escalate-tasks
 *
 * Resolves the tenant's SLA config for each priority tier, computes the
 * escalation deadline per priority, and bulk-updates qualifying tasks.
 * Idempotent: tasks already escalated are skipped (escalated_at IS NOT NULL).
 *
 * Returns { escalated: number } — the count of tasks newly stamped.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    // Optional: scope sweep to a specific capture lead or cap batch size.
    const captureLeadId = typeof body?.captureLeadId === 'string' ? body.captureLeadId.trim() : null;
    const batchLimit = typeof body?.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 1000) : 500;

    const result = await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return { forbidden: true } as const;
      }

      // Fetch the org's SLA config to derive per-priority escalation deadlines.
      const slaRows = await client.query<{
        priority: string;
        escalation_hours: number;
      }>(
        `SELECT priority, escalation_hours
           FROM platform.lead_task_sla_config
          WHERE tenant_id = $1
            AND organization_id = $2`,
        [context.tenantId, context.organizationId],
      );

      // Build a SQL CASE expression mapping priority → escalation deadline.
      // Tasks without a configured tier inherit no deadline and are skipped.
      if (slaRows.rows.length === 0) {
        return { escalated: 0 };
      }

      const caseFragments = slaRows.rows.map(
        (r, i) => `WHEN priority = $${i + 3} THEN now() - ($${slaRows.rows.length + 3 + i} * interval '1 hour')`,
      );
      const caseValues = [
        ...slaRows.rows.map((r) => r.priority),
        ...slaRows.rows.map((r) => r.escalation_hours),
      ];

      // Scope to open tasks that have a due_at and haven't been escalated yet.
      const params: unknown[] = [
        context.tenantId,
        context.organizationId,
        ...caseValues,
      ];

      let captureLeadFilter = '';
      if (captureLeadId) {
        params.push(captureLeadId);
        captureLeadFilter = `AND capture_lead_id = $${params.length}::uuid`;
      }

      params.push(batchLimit);
      const limitParam = `$${params.length}`;

      const updateResult = await client.query<{ task_id: string }>(
        `UPDATE platform.lead_tasks
            SET escalated_at = now(), updated_at = now()
          WHERE tenant_id = $1
            AND organization_id = $2
            AND status = 'OPEN'
            AND escalated_at IS NULL
            AND due_at IS NOT NULL
            AND due_at < CASE priority
                ${caseFragments.join('\n                ')}
                ELSE NULL END
            ${captureLeadFilter}
          LIMIT ${limitParam}
          RETURNING task_id`,
        params,
      );

      return { escalated: updateResult.rowCount ?? 0 };
    });

    if (typeof result === 'object' && 'forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' },
        { status: 403 },
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('SLA escalation sweep error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
