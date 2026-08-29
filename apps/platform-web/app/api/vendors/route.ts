import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../lib/governance-authz';

/**
 * Vendors — a non-CRM governed entity onboarded through the Decision Fabric.
 * Tenant-scoped via RLS; reads require membership, writes require a governing
 * role. GET lists the tenant's vendors; POST registers one in PENDING, bound to
 * the vendor.onboarding blueprint so its workflow can be started.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface VendorRow {
  readonly vendorId: string;
  readonly legalName: string;
  readonly taxId: string | null;
  readonly category: string | null;
  readonly status: string;
  readonly blueprintKey: string | null;
  readonly workflowInstanceId: string | null;
  readonly stageKey: string | null;
  readonly createdAt: string;
}

function toVendor(row: any): VendorRow {
  return {
    vendorId: row.vendor_id,
    legalName: row.legal_name,
    taxId: row.tax_id ?? null,
    category: row.category ?? null,
    status: row.status,
    blueprintKey: row.blueprint_key ?? null,
    workflowInstanceId: row.workflow_instance_id ?? null,
    stageKey: row.stage_key ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const vendors = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT vendor_id, legal_name, tax_id, category, status, blueprint_key,
                workflow_instance_id, stage_key, created_at
           FROM platform.vendors
          ORDER BY created_at DESC
          LIMIT 200`,
      );
      return result.rows.map(toVendor);
    });
    return NextResponse.json(vendors);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();
    const legalName = typeof body?.legalName === 'string' ? body.legalName.trim() : '';
    if (legalName === '' || legalName.length > 200) {
      return NextResponse.json({ error: 'A legal name (1–200 characters) is required.' }, { status: 400 });
    }
    const taxId = typeof body?.taxId === 'string' && body.taxId.trim() !== '' ? body.taxId.trim() : null;
    const category = typeof body?.category === 'string' && body.category.trim() !== '' ? body.category.trim() : null;

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      await client.query('BEGIN');
      try {
        await context.applyTo(client);
        const inserted = await client.query(
          `INSERT INTO platform.vendors (tenant_id, legal_name, tax_id, category, status, blueprint_key, owner_subject_id)
           VALUES ($1::uuid, $2, $3, $4, 'PENDING', 'vendor.onboarding', $5)
           RETURNING vendor_id`,
          [context.tenantId, legalName, taxId, category, context.subjectId],
        );
        await client.query('COMMIT');
        return { vendorId: inserted.rows[0].vendor_id as string } as const;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to register a vendor.' }, { status: 403 });
    }
    return NextResponse.json({ success: true, vendorId: result.vendorId }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
