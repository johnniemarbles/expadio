import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../../../lib/crm-authz';
import { toLead } from '../../route';
import { toCase } from '../../../cases/route';
import { resolveCaseSchema, validateCaseAttributes } from '@expadio/industry-packs';
import { PostgresIndustryPackRuntimeResolver } from '@expadio/postgres-runtime/industry-pack-runtime';
import { startWorkflow } from '../../../../../../lib/workflow-runtime';
import type { WorkflowIndustryPackProvenance } from '@expadio/workflow';

/**
 * Convert a won piece of business into a customer.
 *
 * This is the seam that makes the CRM spine a *funnel* rather than three
 * disconnected tabs: a lead becomes a customer Account (created if the lead was
 * not already attached to one, promoted to the CUSTOMER lifecycle either way),
 * the lead is marked WON and linked to that account, and — optionally — an
 * onboarding Case is opened against the new customer so the work of delivering
 * has a home.
 *
 * Governed and tenant-scoped: reads/writes run under RLS, and mutation requires
 * a governing role. The whole conversion is one transaction — partial funnels
 * are worse than none, so either every step lands or none does.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function workflowPackProvenance(
  provenance: {
    readonly source: 'TENANT_PUBLISHED' | 'PLATFORM_PUBLISHED' | 'CODE_BASELINE' | 'NEUTRAL';
    readonly verticalKey: string | null;
    readonly version: number | null;
  },
): WorkflowIndustryPackProvenance {
  if (provenance.source === 'NEUTRAL') return { runtimeSource: 'NEUTRAL' };
  const verticalKey = provenance.verticalKey;
  if (verticalKey === null || verticalKey.trim() === '') {
    throw new Error('INDUSTRY_PACK_PROVENANCE_VERTICAL_KEY_MISSING');
  }
  if (provenance.source === 'CODE_BASELINE') {
    return {
      runtimeSource: 'CODE_BASELINE',
      verticalKey,
      ...(provenance.version === null ? {} : { version: provenance.version }),
    };
  }
  const version = provenance.version;
  if (version === null || !Number.isInteger(version) || version <= 0) {
    throw new Error('INDUSTRY_PACK_PROVENANCE_VERSION_INVALID');
  }
  return { runtimeSource: provenance.source, verticalKey, version };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const leadId = decodeURIComponent((await params).id);

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const openCase = body?.openCase === true;
    const caseSubjectRaw = typeof body?.caseSubject === 'string' ? body.caseSubject.trim() : '';
    const caseAttributes = body?.caseAttributes && typeof body.caseAttributes === 'object'
      ? body.caseAttributes as Record<string, unknown>
      : {};

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }

      // Re-apply the tenant GUC inside an explicit transaction so RLS holds for
      // every step and the multi-write conversion is atomic.
      await client.query('BEGIN');
      try {
        await context.applyTo(client);

        const leadRes = await client.query(
          `SELECT lead_id, tenant_id, account_id, contact_id, title, stage,
                  amount_minor_units, currency, source, owner_subject_id, created_at, updated_at
             FROM platform.crm_leads
            WHERE lead_id = $1::uuid
            FOR UPDATE`,
          [leadId],
        );
        if (leadRes.rows.length === 0) {
          await client.query('ROLLBACK');
          return { notFound: true } as const;
        }
        const leadRow = leadRes.rows[0];
        if (leadRow.stage === 'LOST') {
          await client.query('ROLLBACK');
          return { lost: true } as const;
        }

        // Resolve the customer account: reuse the lead's account if present
        // (promoting it to CUSTOMER), else create one named after the lead.
        let accountRow;
        if (leadRow.account_id) {
          const promoted = await client.query(
            `UPDATE platform.crm_accounts
                SET lifecycle_stage = 'CUSTOMER', updated_at = now()
              WHERE account_id = $1::uuid
              RETURNING account_id, tenant_id, organization_id, name, domain, industry,
                        lifecycle_stage, status, created_at, updated_at`,
            [leadRow.account_id],
          );
          accountRow = promoted.rows[0];
        } else {
          const created = await client.query(
            `INSERT INTO platform.crm_accounts (tenant_id, name, lifecycle_stage)
             VALUES ($1::uuid, $2, 'CUSTOMER')
             RETURNING account_id, tenant_id, organization_id, name, domain, industry,
                       lifecycle_stage, status, created_at, updated_at`,
            [context.tenantId, leadRow.title.slice(0, 200)],
          );
          accountRow = created.rows[0];
        }

        const wonLead = await client.query(
          `UPDATE platform.crm_leads
              SET stage = 'WON', account_id = $2::uuid, updated_at = now()
            WHERE lead_id = $1::uuid
            RETURNING lead_id, tenant_id, account_id, contact_id, title, stage,
                      amount_minor_units, currency, source, owner_subject_id, created_at, updated_at`,
          [leadId, accountRow.account_id],
        );

        let caseRow = null;
        if (openCase) {
          const vertical = await client.query(
            `SELECT vertical_key FROM platform.tenants WHERE tenant_id = $1::uuid`,
            [context.tenantId],
          );
          const runtimePack = await new PostgresIndustryPackRuntimeResolver(client).resolve({
            tenantId: context.tenantId,
            verticalKey: vertical.rows[0]?.vertical_key ?? null,
          });
          const validated = validateCaseAttributes(resolveCaseSchema(runtimePack.pack), caseAttributes);
          if (!validated.ok) {
            await client.query('ROLLBACK');
            return { invalidCaseAttributes: true, errors: validated.errors } as const;
          }
          const schemaVersion = validated.schemaVersion > 0 ? validated.schemaVersion : null;
          const subject = (caseSubjectRaw || `Onboarding — ${accountRow.name}`).slice(0, 200);
          const insertedCase = await client.query(
            `INSERT INTO platform.crm_cases
               (tenant_id, account_id, contact_id, subject, priority, status, blueprint_key, owner_subject_id,
                attributes, attributes_schema_version,
                industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source)
             VALUES ($1::uuid, $2::uuid, $3, $4, 'NORMAL', 'OPEN', 'crm.case', $5,
                     $6::jsonb, $7, $8, $9, $10)
             RETURNING case_id, tenant_id, account_id, contact_id, subject, description, priority, status,
                       blueprint_key, workflow_instance_id, stage_key, owner_subject_id,
                       attributes, attributes_schema_version,
                       industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source,
                       created_at, updated_at`,
            [
              context.tenantId,
              accountRow.account_id,
              leadRow.contact_id,
              subject,
              context.subjectId,
              JSON.stringify(validated.attributes),
              schemaVersion,
              runtimePack.provenance.verticalKey,
              runtimePack.provenance.version,
              runtimePack.provenance.source,
            ],
          );
          const createdCase = insertedCase.rows[0];
          const started = await startWorkflow(client, {
            tenantId: context.tenantId,
            subjectType: 'crm.case',
            subjectId: createdCase.case_id,
            blueprintKey: 'crm.case',
            industryPackProvenance: workflowPackProvenance(runtimePack.provenance),
          });
          if (!started.ok) {
            await client.query('ROLLBACK');
            return { noWorkflowBlueprint: true } as const;
          }

          const boundCase = await client.query(
            `UPDATE platform.crm_cases
                SET workflow_instance_id = $2::uuid,
                    stage_key = $3,
                    updated_at = now()
              WHERE case_id = $1::uuid
              RETURNING case_id, tenant_id, account_id, contact_id, subject, description, priority, status,
                        blueprint_key, workflow_instance_id, stage_key, owner_subject_id,
                        attributes, attributes_schema_version,
                        industry_pack_vertical_key, industry_pack_version, industry_pack_runtime_source,
                        created_at, updated_at`,
            [createdCase.case_id, started.instance.instanceId, started.instance.currentStageKey ?? null],
          );
          caseRow = boundCase.rows[0];
        }

        await client.query('COMMIT');
        return {
          account: {
            accountId: accountRow.account_id,
            tenantId: accountRow.tenant_id,
            organizationId: accountRow.organization_id ?? null,
            name: accountRow.name,
            domain: accountRow.domain ?? null,
            industry: accountRow.industry ?? null,
            lifecycleStage: accountRow.lifecycle_stage,
            status: accountRow.status,
            createdAt: new Date(accountRow.created_at).toISOString(),
            updatedAt: new Date(accountRow.updated_at).toISOString(),
          },
          lead: toLead(wonLead.rows[0]),
          case: caseRow ? toCase(caseRow) : null,
        } as const;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });

    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to convert leads.' },
        { status: 403 },
      );
    }
    if ('notFound' in result) {
      return NextResponse.json({ error: 'That lead was not found in this workspace.' }, { status: 404 });
    }
    if ('lost' in result) {
      return NextResponse.json({ error: 'A lost lead cannot be converted. Reopen it first.' }, { status: 409 });
    }
    if ('invalidCaseAttributes' in result) {
      const errors = result.errors ?? [];
      return NextResponse.json({ error: errors.join(' '), fields: errors }, { status: 400 });
    }
    if ('noWorkflowBlueprint' in result) {
      return NextResponse.json({ error: 'No active crm.case workflow blueprint is available.' }, { status: 409 });
    }
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
