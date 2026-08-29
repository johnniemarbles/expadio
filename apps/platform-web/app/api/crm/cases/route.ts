import { NextResponse } from 'next/server';
import { validateCaseInput, CaseValidationError, type CrmCase } from '@expadio/case';
import { resolveCaseSchema, validateCaseAttributes } from '@expadio/industry-packs';
import { PostgresIndustryPackRuntimeResolver } from '@expadio/postgres-runtime/industry-pack-runtime';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../lib/crm-authz';

/**
 * CRM cases (units of work). Tenant-scoped via RLS; reads require membership,
 * writes require a governing role. Backed by the @expadio/case domain.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function toCase(row: any): CrmCase & { accountName: string | null; attributes: Record<string, string>; attributesSchemaVersion: number | null } {
  return {
    caseId: row.case_id,
    tenantId: row.tenant_id,
    accountId: row.account_id ?? null,
    contactId: row.contact_id ?? null,
    subject: row.subject,
    description: row.description ?? null,
    priority: row.priority,
    status: row.status,
    blueprintKey: row.blueprint_key ?? null,
    workflowInstanceId: row.workflow_instance_id ?? null,
    stageKey: row.stage_key ?? null,
    ownerSubjectId: row.owner_subject_id ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    accountName: row.account_name ?? null,
    // Pack-declared domain fields (empty on the neutral engine).
    attributes: (row.attributes && typeof row.attributes === 'object') ? row.attributes : {},
    // The pack schema revision those attributes were validated against (null on
    // the neutral engine / a case with no pack data).
    attributesSchemaVersion: row.attributes_schema_version ?? null,
  };
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const url = new URL(request.url);
    const status = url.searchParams.get('status')?.trim().toUpperCase() ?? '';
    const accountId = url.searchParams.get('accountId')?.trim() ?? '';

    const cases = await withTenantClient(context, async (client) => {
      const result = await client.query(
        `SELECT c.case_id, c.tenant_id, c.account_id, c.contact_id, c.subject, c.description,
                c.priority, c.status, c.blueprint_key, c.workflow_instance_id, c.stage_key,
                c.owner_subject_id, c.attributes, c.attributes_schema_version, c.created_at, c.updated_at, a.name AS account_name
           FROM platform.crm_cases c
           LEFT JOIN platform.crm_accounts a ON a.account_id = c.account_id
          WHERE ($1 = '' OR c.status = $1)
            AND ($2 = '' OR c.account_id = $2::uuid)
          ORDER BY
            CASE c.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
            c.created_at DESC
          LIMIT 200`,
        [status, accountId],
      );
      return result.rows.map(toCase);
    });

    return NextResponse.json(cases);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    let body: Record<string, unknown>;
    let input;
    try {
      body = await request.json();
      input = validateCaseInput(body);
    } catch (error) {
      if (error instanceof CaseValidationError) {
        return NextResponse.json({ error: error.message, field: error.field }, { status: 400 });
      }
      throw error;
    }
    const rawAttributes = (body.attributes && typeof body.attributes === 'object') ? body.attributes as Record<string, unknown> : {};

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      // Resolve the tenant's executable Industry Pack from governed runtime sources.
      // Published tenant/platform definitions are authoritative; the code registry
      // remains only the compatibility fallback inside the resolver.
      const vertical = await client.query(
        `SELECT vertical_key FROM platform.tenants WHERE tenant_id = $1::uuid`,
        [context.tenantId],
      );
      const runtimePack = await new PostgresIndustryPackRuntimeResolver(client).resolve({
        tenantId: context.tenantId,
        verticalKey: vertical.rows[0]?.vertical_key ?? null,
      });
      const validated = validateCaseAttributes(resolveCaseSchema(runtimePack.pack), rawAttributes);
      if (!validated.ok) return { invalidAttributes: true, errors: validated.errors } as const;
      // Stamp the schema revision that validated these attributes (null on the
      // neutral engine, version 0), so the value bag stays tied to its field set.
      const schemaVersion = validated.schemaVersion > 0 ? validated.schemaVersion : null;

      try {
        const inserted = await client.query(
          `INSERT INTO platform.crm_cases
             (tenant_id, account_id, contact_id, subject, description, priority, status, blueprint_key, owner_subject_id, attributes, attributes_schema_version)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
           RETURNING case_id, tenant_id, account_id, contact_id, subject, description, priority, status,
                     blueprint_key, workflow_instance_id, stage_key, owner_subject_id, attributes, attributes_schema_version, created_at, updated_at`,
          [
            context.tenantId, input.accountId, input.contactId, input.subject, input.description,
            input.priority, input.status, input.blueprintKey, context.subjectId, JSON.stringify(validated.attributes), schemaVersion,
          ],
        );
        return { case: toCase(inserted.rows[0]) } as const;
      } catch (err: any) {
        if (err?.code === '23503') return { badRef: true } as const;
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to create cases.' }, { status: 403 });
    }
    if ('invalidAttributes' in result) {
      const errors = result.errors ?? [];
      return NextResponse.json({ error: errors.join(' '), fields: errors }, { status: 400 });
    }
    if ('badRef' in result) {
      return NextResponse.json({ error: 'The linked account or contact does not exist in this workspace.' }, { status: 400 });
    }
    return NextResponse.json({ success: true, case: result.case }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
