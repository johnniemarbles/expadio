import { NextResponse } from 'next/server';
import {
  approvalRequirementForChangeType,
  type LeadManagementChangeType,
} from '@expadio/lead-capture';
import { listInterestTypes, resolveInterestType } from '@expadio/lead-capture';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_INTEREST_TYPES = new Set([
  'FRANCHISEE', 'MASTER_FRANCHISEE', 'DISTRIBUTOR', 'AFFILIATE', 'LICENSEE', 'AGENT',
]);
const VALID_OPPORTUNITY_TYPES = new Set([
  'SINGLE_UNIT', 'MULTI_UNIT', 'AREA_DEVELOPMENT', 'CONVERSION', 'RESALE',
  'EXCLUSIVE_DISTRIBUTOR', 'NON_EXCLUSIVE_DISTRIBUTOR', 'MASTER_DISTRIBUTOR', 'SUB_DISTRIBUTOR',
]);

// ── GET: list configurations for this organization ────────────────────────────

export async function GET() {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    return await withBrandTransaction(context, async (client) => {
      const result = await client.query(
        `SELECT config_id, tenant_id, organization_id, parent_config_id,
                interest_type, opportunity_type,
                schema_key, qualification_profile_key, workflow_blueprint_key,
                evidence_profile_key, default_routing_profile_key,
                supported_publication_modes, review_sla_business_days,
                status, version, created_at, updated_at, published_at,
                submitted_for_review_at, expires_at
           FROM platform.lead_management_configurations
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid
          ORDER BY created_at DESC`,
        [context.tenantId, context.organizationId],
      );
      return NextResponse.json({
        configurations: result.rows.map((row) => ({
          configId: row.config_id,
          tenantId: row.tenant_id,
          organizationId: row.organization_id,
          parentConfigId: row.parent_config_id,
          interestType: row.interest_type,
          opportunityType: row.opportunity_type,
          schemaKey: row.schema_key,
          qualificationProfileKey: row.qualification_profile_key,
          workflowBlueprintKey: row.workflow_blueprint_key,
          evidenceProfileKey: row.evidence_profile_key,
          defaultRoutingProfileKey: row.default_routing_profile_key,
          supportedPublicationModes: row.supported_publication_modes ?? [],
          reviewSlaBusinessDays: row.review_sla_business_days,
          status: row.status,
          version: row.version,
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
          publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
          submittedForReviewAt: row.submitted_for_review_at ? new Date(row.submitted_for_review_at).toISOString() : null,
          expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
        })),
        availableInterestTypes: listInterestTypes().map((e) => ({
          interestType: e.interestType,
          opportunityType: e.opportunityType ?? null,
          label: e.label,
          schemaKey: e.schemaKey,
          qualificationProfileKey: e.qualificationProfileKey,
          workflowBlueprintKey: e.workflowBlueprintKey,
          evidenceProfileKey: e.evidenceProfileKey,
          defaultRoutingProfileKey: e.defaultRoutingProfileKey,
          supportedPublicationModes: e.supportedPublicationModes,
        })),
      });
    });
  } catch (error) {
    console.error('Lead management configuration read failed:', error);
    return NextResponse.json({ error: 'Unable to load configurations.' }, { status: 500 });
  }
}

// ── POST: create a new DRAFT configuration ────────────────────────────────────

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }

    const body = await request.json();
    const interestType = typeof body.interestType === 'string' ? body.interestType.trim().toUpperCase() : '';
    const opportunityType = typeof body.opportunityType === 'string' && body.opportunityType.trim()
      ? body.opportunityType.trim().toUpperCase()
      : null;
    const reviewSlaBusinessDays = body.reviewSlaBusinessDays === undefined ? 5 : Number(body.reviewSlaBusinessDays);

    if (!VALID_INTEREST_TYPES.has(interestType)) {
      return NextResponse.json({ error: `interestType must be one of: ${[...VALID_INTEREST_TYPES].join(', ')}` }, { status: 400 });
    }
    if (opportunityType !== null && !VALID_OPPORTUNITY_TYPES.has(opportunityType)) {
      return NextResponse.json({ error: `opportunityType must be one of: ${[...VALID_OPPORTUNITY_TYPES].join(', ')}` }, { status: 400 });
    }
    if (!Number.isInteger(reviewSlaBusinessDays) || reviewSlaBusinessDays < 1 || reviewSlaBusinessDays > 30) {
      return NextResponse.json({ error: 'reviewSlaBusinessDays must be 1–30.' }, { status: 400 });
    }

    // Resolve behavioral keys from the registry — interestType locks the schemaKey.
    const registryEntry = resolveInterestType(
      interestType as Parameters<typeof resolveInterestType>[0],
      opportunityType as Parameters<typeof resolveInterestType>[1] ?? undefined,
    );
    if (!registryEntry) {
      return NextResponse.json({ error: 'This interestType + opportunityType combination is not in the registry.' }, { status: 422 });
    }

    // Optional key overrides (BOUNDED_SAME_DOMAIN / OVERRIDABLE per KEY_OVERRIDE_MODES).
    const qualificationProfileKey = typeof body.qualificationProfileKey === 'string' && body.qualificationProfileKey.trim()
      ? body.qualificationProfileKey.trim()
      : registryEntry.qualificationProfileKey;
    const workflowBlueprintKey = typeof body.workflowBlueprintKey === 'string' && body.workflowBlueprintKey.trim()
      ? body.workflowBlueprintKey.trim()
      : registryEntry.workflowBlueprintKey;
    const evidenceProfileKey = typeof body.evidenceProfileKey === 'string' && body.evidenceProfileKey.trim()
      ? body.evidenceProfileKey.trim()
      : registryEntry.evidenceProfileKey;
    const defaultRoutingProfileKey = typeof body.defaultRoutingProfileKey === 'string' && body.defaultRoutingProfileKey.trim()
      ? body.defaultRoutingProfileKey.trim()
      : registryEntry.defaultRoutingProfileKey;

    // BOUNDED_SAME_DOMAIN: overridden key must share the first two colon segments.
    function sameKeyDomain(override: string, registry: string): boolean {
      const [a1, a2] = override.split(':');
      const [b1, b2] = registry.split(':');
      return a1 === b1 && a2 === b2;
    }
    if (!sameKeyDomain(qualificationProfileKey, registryEntry.qualificationProfileKey)) {
      return NextResponse.json({ error: 'qualificationProfileKey must be in the same domain as the registry value.' }, { status: 422 });
    }
    if (!sameKeyDomain(workflowBlueprintKey, registryEntry.workflowBlueprintKey)) {
      return NextResponse.json({ error: 'workflowBlueprintKey must be in the same domain as the registry value.' }, { status: 422 });
    }
    if (!sameKeyDomain(evidenceProfileKey, registryEntry.evidenceProfileKey)) {
      return NextResponse.json({ error: 'evidenceProfileKey must be in the same domain as the registry value.' }, { status: 422 });
    }

    // Determine the approval requirement for this change type.
    const changeType: LeadManagementChangeType = 'INTEREST_TYPE_ACTIVATION';
    const approvalRequirement = approvalRequirementForChangeType(changeType);

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }
      try {
        const inserted = await client.query(
          `INSERT INTO platform.lead_management_configurations
             (tenant_id, organization_id,
              interest_type, opportunity_type,
              schema_key, qualification_profile_key, workflow_blueprint_key,
              evidence_profile_key, default_routing_profile_key,
              supported_publication_modes, review_sla_business_days,
              status, version)
           VALUES ($1::uuid, $2::uuid,
                   $3, $4,
                   $5, $6, $7,
                   $8, $9,
                   $10::text[], $11,
                   'DRAFT', 1)
           RETURNING config_id, status, version, created_at`,
          [
            context.tenantId, context.organizationId,
            interestType, opportunityType,
            registryEntry.schemaKey, qualificationProfileKey, workflowBlueprintKey,
            evidenceProfileKey, defaultRoutingProfileKey,
            registryEntry.supportedPublicationModes, reviewSlaBusinessDays,
          ],
        );
        const row = inserted.rows[0];
        return NextResponse.json({
          success: true,
          configId: row.config_id,
          status: row.status,
          version: row.version,
          schemaKey: registryEntry.schemaKey,
          qualificationProfileKey,
          workflowBlueprintKey,
          evidenceProfileKey,
          defaultRoutingProfileKey,
          supportedPublicationModes: registryEntry.supportedPublicationModes,
          approvalRequirement,
          createdAt: new Date(row.created_at).toISOString(),
        }, { status: 201 });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          return NextResponse.json({ error: 'A configuration for this interest type already exists in this organization.' }, { status: 409 });
        }
        throw error;
      }
    });
  } catch (error) {
    console.error('Lead management configuration creation failed:', error);
    return NextResponse.json({ error: 'Unable to create configuration.' }, { status: 500 });
  }
}
