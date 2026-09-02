import { NextResponse } from 'next/server';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';

interface DriftRow {
  readonly descendant_organization_id: string;
  readonly ancestor_organization_id: string;
  readonly legacy_depth: number | null;
  readonly graph_depth: number | null;
  readonly drift_kind: 'GRAPH_ONLY' | 'LEGACY_ONLY' | 'DEPTH_MISMATCH';
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED',
          message: 'Select an active organization workspace.',
        },
        { status: 403 },
      );
    }

    const result = await withTenantTransaction(context, async (client) => {
      const [control, drift] = await Promise.all([
        client.query<{
          graph_reads_enabled: boolean;
          drift_checked_at: Date | string | null;
          drift_free_at: Date | string | null;
        }>(
          `SELECT
             platform.entity_graph_reads_enabled($1::uuid) AS graph_reads_enabled,
             control.drift_checked_at,
             control.drift_free_at
           FROM (SELECT 1) singleton
           LEFT JOIN platform.entity_graph_read_controls control
             ON control.tenant_id = $1::uuid`,
          [context.tenantId],
        ),
        client.query<DriftRow>(
          `SELECT
             descendant_organization_id,
             ancestor_organization_id,
             legacy_depth,
             graph_depth,
             drift_kind
           FROM platform.compare_operational_graph_to_legacy($1::uuid, now())
           ORDER BY drift_kind, descendant_organization_id, ancestor_organization_id
           LIMIT 100`,
          [context.tenantId],
        ),
      ]);

      const state = control.rows[0];
      const graphReadsEnabled = state?.graph_reads_enabled ?? false;
      return {
        perspective: 'OPERATIONAL',
        graphReadsEnabled,
        rollbackMode: !graphReadsEnabled,
        driftFree: drift.rows.length === 0,
        driftCount: drift.rowCount ?? drift.rows.length,
        driftCheckedAt: state?.drift_checked_at ?? null,
        driftFreeAt: state?.drift_free_at ?? null,
        drift: drift.rows.map((row) => ({
          descendantOrganizationId: row.descendant_organization_id,
          ancestorOrganizationId: row.ancestor_organization_id,
          legacyDepth: row.legacy_depth,
          graphDepth: row.graph_depth,
          kind: row.drift_kind,
        })),
      };
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
