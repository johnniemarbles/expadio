import { NextResponse } from 'next/server';
import { classifyConfigTransition } from '@expadio/lead-capture';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/leads/management/configurations/:configId/publish
 *
 * Publishes a root configuration (parentConfigId IS NULL) in one step:
 *   DRAFT → APPROVED → PUBLISHED
 *
 * A root config has no parent organization above it — the TENANT_OWNER is
 * the governance authority. DRAFT → APPROVED is not in ANCESTOR_ACTION_REQUIRED,
 * so this transition is valid for the config owner without any external approval.
 *
 * Only DRAFT configurations may be published this way. APPROVED configs skip
 * directly to PUBLISHED. PENDING_PARENT_REVIEW and ESCALATED still require
 * an ancestor action and are not handled here.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ configId: string }> },
) {
  try {
    const { configId } = await params;
    if (!configId || !/^[0-9a-f-]{36}$/i.test(configId)) {
      return NextResponse.json({ error: 'Invalid configId.' }, { status: 400 });
    }

    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance role required to publish configurations.' }, { status: 403 });
      }

      // Load the config and assert ownership.
      const existing = await client.query(
        `SELECT config_id, parent_config_id, status, interest_type, opportunity_type
           FROM platform.lead_management_configurations
          WHERE config_id = $1::uuid
            AND tenant_id = $2::uuid
            AND organization_id = $3::uuid`,
        [configId, context.tenantId, context.organizationId],
      );
      if (!existing.rows[0]) {
        return NextResponse.json({ error: 'Configuration not found.' }, { status: 404 });
      }

      const cfg = existing.rows[0] as {
        config_id: string;
        parent_config_id: string | null;
        status: string;
        interest_type: string;
        opportunity_type: string | null;
      };

      // Only root configs (Brand HQ level) may self-publish. Child configs require
      // an ancestor's approval through PENDING_PARENT_REVIEW or ESCALATED.
      if (cfg.parent_config_id !== null) {
        return NextResponse.json({
          error: 'Only root configurations (Brand HQ level) may be self-published. Child configurations require parent approval.',
          reasonKey: 'PARENT_APPROVAL_REQUIRED',
        }, { status: 422 });
      }

      const currentStatus = cfg.status as 'DRAFT' | 'APPROVED' | 'PUBLISHED' | string;

      if (currentStatus === 'PUBLISHED') {
        return NextResponse.json({ error: 'Configuration is already published.' }, { status: 409 });
      }

      // DRAFT → APPROVED: valid per state machine (not in ANCESTOR_ACTION_REQUIRED for root).
      // APPROVED → PUBLISHED: valid per state machine.
      // PENDING_PARENT_REVIEW or ESCALATED: must go through ancestor workflow.
      if (!['DRAFT', 'APPROVED'].includes(currentStatus)) {
        return NextResponse.json({
          error: `Cannot publish a configuration in ${currentStatus} status. Only DRAFT or APPROVED configurations can be published by a brand admin.`,
          reasonKey: 'STATUS_TRANSITION_BLOCKED',
        }, { status: 422 });
      }

      // Validate the transition chain.
      if (currentStatus === 'DRAFT') {
        const toApproved = classifyConfigTransition('DRAFT', 'APPROVED');
        if (!toApproved.allowed) {
          return NextResponse.json({ error: 'DRAFT → APPROVED transition not allowed.', reasonKey: toApproved.reason }, { status: 422 });
        }
      }
      const toPublished = classifyConfigTransition(
        currentStatus === 'DRAFT' ? 'APPROVED' : 'APPROVED',
        'PUBLISHED',
      );
      if (!toPublished.allowed) {
        return NextResponse.json({ error: 'APPROVED → PUBLISHED transition not allowed.', reasonKey: toPublished.reason }, { status: 422 });
      }

      // Execute the transition atomically.
      const now = new Date().toISOString();
      const updated = await client.query(
        `UPDATE platform.lead_management_configurations
            SET status = 'PUBLISHED',
                published_at = $2::timestamptz,
                updated_at = $2::timestamptz
          WHERE config_id = $1::uuid
          RETURNING config_id, status, published_at`,
        [configId, now],
      );

      const row = updated.rows[0];
      return NextResponse.json({
        success: true,
        configId: row.config_id,
        status: row.status,
        publishedAt: new Date(row.published_at).toISOString(),
        message: 'Configuration published. You can now create publications for this interest type.',
      });
    });
  } catch (error) {
    console.error('Configuration publish failed:', error);
    return NextResponse.json({ error: 'Unable to publish configuration.' }, { status: 500 });
  }
}
