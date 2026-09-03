import { NextResponse } from 'next/server';
import { loadTenantProductModule } from '@expadio/postgres-runtime/product-module';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > max || /[\0\r]/u.test(text)) return null;
  return text;
}

async function requireRoutingGovernance(context: Awaited<ReturnType<typeof resolveBrandContext>>) {
  return withBrandTransaction(context, async (client) => {
    const module = await loadTenantProductModule(client, {
      tenantId: context.tenantId,
      moduleKey: 'lead-management',
    });
    if (module?.availability !== 'ACTIVE') {
      return { denied: NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 }) } as const;
    }
    if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
      return { denied: NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 }) } as const;
    }
    return { client } as const;
  });
}

export async function GET() {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }

    return await withBrandTransaction(context, async (client) => {
      const module = await loadTenantProductModule(client, {
        tenantId: context.tenantId,
        moduleKey: 'lead-management',
      });
      if (module?.availability !== 'ACTIVE') {
        return NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 });
      }
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }

      const result = await client.query<{
        routing_rule_id: string;
        name: string;
        priority: number;
        source_id: string | null;
        source_key: string | null;
        target_subject_id: string;
        status: 'ACTIVE' | 'DISABLED';
        created_at: Date | string;
        updated_at: Date | string;
      }>(
        `SELECT r.routing_rule_id, r.name, r.priority, r.source_id, s.source_key,
                r.target_subject_id, r.status, r.created_at, r.updated_at
           FROM platform.lead_capture_routing_rules r
           LEFT JOIN platform.lead_capture_sources s
             ON s.source_id = r.source_id
            AND s.tenant_id = r.tenant_id
            AND s.organization_id = r.organization_id
          WHERE r.tenant_id = $1::uuid
            AND r.organization_id = $2::uuid
          ORDER BY r.priority ASC, r.routing_rule_id ASC`,
        [context.tenantId, context.organizationId],
      );

      return NextResponse.json({
        organizationId: context.organizationId,
        rules: result.rows.map((row) => ({
          routingRuleId: row.routing_rule_id,
          name: row.name,
          priority: row.priority,
          sourceId: row.source_id,
          sourceKey: row.source_key,
          targetSubjectId: row.target_subject_id,
          status: row.status,
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        })),
      });
    });
  } catch (error) {
    console.error('Brand Demand Capture routing rules read failed:', error);
    return NextResponse.json({ error: 'Unable to load Demand Capture routing rules.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const name = boundedString(body.name, 160);
    const targetSubjectId = boundedString(body.targetSubjectId, 320);
    const priority = Number(body.priority);
    const sourceId = body.sourceId == null || body.sourceId === '' ? null : String(body.sourceId).trim();
    if (!name || !targetSubjectId || !Number.isInteger(priority) || priority < 0 || priority > 100000) {
      return NextResponse.json({ error: 'Routing rule name, target subject and a valid priority are required.' }, { status: 400 });
    }
    if (sourceId && !UUID.test(sourceId)) {
      return NextResponse.json({ error: 'Invalid capture source identifier.' }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      const module = await loadTenantProductModule(client, {
        tenantId: context.tenantId,
        moduleKey: 'lead-management',
      });
      if (module?.availability !== 'ACTIVE') {
        return NextResponse.json({ denied: true, reasonKey: 'LEAD_MODULE_NOT_ACTIVE' }, { status: 403 });
      }
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }

      const target = await client.query<{ allowed: boolean }>(
        `SELECT platform.subject_can_access_organization($1::uuid,$2,$3,$4::uuid) AS allowed`,
        [context.tenantId, targetSubjectId, context.issuer, context.organizationId],
      );
      if (!target.rows[0]?.allowed) {
        return NextResponse.json({
          denied: true,
          reasonKey: 'ROUTING_TARGET_NOT_ELIGIBLE',
          message: 'The target subject does not hold an active membership covering this organization.',
        }, { status: 409 });
      }

      if (sourceId) {
        const source = await client.query(
          `SELECT 1
             FROM platform.lead_capture_sources
            WHERE tenant_id = $1::uuid
              AND organization_id = $2::uuid
              AND source_id = $3::uuid
              AND status = 'ACTIVE'`,
          [context.tenantId, context.organizationId, sourceId],
        );
        if (source.rows.length === 0) {
          return NextResponse.json({ error: 'Capture source is not active or not visible in this organization.' }, { status: 400 });
        }
      }

      try {
        const inserted = await client.query<{
          routing_rule_id: string;
          name: string;
          priority: number;
          source_id: string | null;
          target_subject_id: string;
          status: 'ACTIVE' | 'DISABLED';
        }>(
          `INSERT INTO platform.lead_capture_routing_rules (
             tenant_id, organization_id, name, priority, source_id,
             target_subject_id, status, created_by_subject_id
           ) VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,'ACTIVE',$7)
           RETURNING routing_rule_id, name, priority, source_id, target_subject_id, status`,
          [context.tenantId, context.organizationId, name, priority, sourceId, targetSubjectId, context.subjectId],
        );
        const row = inserted.rows[0];
        return NextResponse.json({
          success: true,
          rule: {
            routingRuleId: row.routing_rule_id,
            name: row.name,
            priority: row.priority,
            sourceId: row.source_id,
            targetSubjectId: row.target_subject_id,
            status: row.status,
          },
        }, { status: 201 });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          return NextResponse.json({
            denied: true,
            reasonKey: 'ROUTING_PRIORITY_CONFLICT',
            message: 'Another routing rule already uses this priority in the selected organization.',
          }, { status: 409 });
        }
        throw error;
      }
    });
  } catch (error) {
    console.error('Brand Demand Capture routing rule create failed:', error);
    return NextResponse.json({ error: 'Unable to create Demand Capture routing rule.' }, { status: 500 });
  }
}
