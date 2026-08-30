import { NextResponse } from 'next/server';
import {
  resolveCaseSchema,
  validateCaseAttributes,
} from '@expadio/industry-packs';
import { PostgresIndustryPackRuntimeResolver } from '@expadio/postgres-runtime/industry-pack-runtime';
import {
  resolveRequestContext,
  withTenantClient,
  withTenantTransaction,
  deniedResponse,
} from '../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../lib/crm-authz';
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

/**
 * Update the Pack-governed clinical attributes of one DENTEX Treatment.
 *
 * The mutation is deliberately vertical-facing rather than broadening the
 * generic CRM case PATCH contract. The active executable DENTEX Pack supplies
 * the schema, allowed values, normalization and schema revision. Existing
 * attributes are merged before validation so callers can update one clinical
 * field without resending the complete value bag.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const treatmentId = decodeURIComponent((await params).id);
    const body = await request.json();
    const patch = body?.attributes;

    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      return NextResponse.json(
        { error: 'Provide Treatment clinical attributes to update.' },
        { status: 400 },
      );
    }

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }

      const existing = await client.query<{
        attributes: Record<string, unknown> | null;
        industry_pack_vertical_key: string | null;
      }>(
        `SELECT attributes, industry_pack_vertical_key
           FROM platform.crm_cases
          WHERE tenant_id = $1::uuid
            AND case_id = $2::uuid
          FOR UPDATE`,
        [context.tenantId, treatmentId],
      );

      const row = existing.rows[0];
      if (row === undefined) return { notFound: true } as const;
      if (row.industry_pack_vertical_key !== 'dentex') {
        return { packMismatch: true } as const;
      }

      const runtimePack = await new PostgresIndustryPackRuntimeResolver(client).resolve({
        tenantId: context.tenantId,
        verticalKey: 'dentex',
      });
      const merged = {
        ...(row.attributes ?? {}),
        ...(patch as Record<string, unknown>),
      };
      const validated = validateCaseAttributes(
        resolveCaseSchema(runtimePack.pack),
        merged,
      );
      if (!validated.ok) {
        return {
          invalidAttributes: true,
          errors: validated.errors,
        } as const;
      }

      await client.query(
        `UPDATE platform.crm_cases
            SET attributes = $3::jsonb,
                attributes_schema_version = $4,
                industry_pack_vertical_key = $5,
                industry_pack_version = $6,
                industry_pack_runtime_source = $7,
                updated_at = clock_timestamp()
          WHERE tenant_id = $1::uuid
            AND case_id = $2::uuid`,
        [
          context.tenantId,
          treatmentId,
          JSON.stringify(validated.attributes),
          validated.schemaVersion > 0 ? validated.schemaVersion : null,
          runtimePack.provenance.verticalKey,
          runtimePack.provenance.version,
          runtimePack.provenance.source,
        ],
      );

      const workspace = await loadDentexTreatmentWorkspace(client, {
        tenantId: context.tenantId,
        treatmentId,
      });
      if (workspace === null) throw new Error('DENTEX_TREATMENT_UPDATE_LOST');

      return { workspace } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'You need a tenant admin role to update Treatment clinical data.',
        },
        { status: 403 },
      );
    }
    if ('notFound' in result) {
      return NextResponse.json(
        { error: 'That Treatment was not found in this workspace.' },
        { status: 404 },
      );
    }
    if ('packMismatch' in result) {
      return NextResponse.json(
        { error: 'That case is not governed as a DENTEX Treatment.' },
        { status: 409 },
      );
    }
    if ('invalidAttributes' in result) {
      return NextResponse.json(
        {
          error: result.errors.join(' '),
          fields: result.errors,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      treatment: result.workspace,
    });
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
