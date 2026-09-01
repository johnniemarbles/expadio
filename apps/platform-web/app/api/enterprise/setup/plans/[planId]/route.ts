import { NextResponse } from 'next/server';
import {
  findOrganizationSetupPlan,
  listOrganizationOperatingEntities,
  listOrganizationSetupRequirements,
  listVerifiedEnterpriseLegalEntities,
} from '@expadio/postgres-runtime/enterprise-onboarding';
import {
  enterpriseSetupErrorResponse,
  withSetupParticipantTransaction,
} from '../../../../../../lib/enterprise-setup-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ planId: string }> },
) {
  try {
    const { planId } = await params;
    const result = await withSetupParticipantTransaction(
      planId,
      async (client, context) => {
        const plan = await findOrganizationSetupPlan(client, {
          tenantId: context.tenantId,
          organizationId: context.organizationId,
        });
        if (!plan || plan.setupPlanId !== planId) {
          throw new Error('ORGANIZATION_SETUP_PLAN_NOT_FOUND');
        }

        const [
          requirements,
          dependencyRows,
          verifiedLegalEntities,
          operatingEntities,
        ] = await Promise.all([
          listOrganizationSetupRequirements(client, {
            tenantId: context.tenantId,
            setupPlanId: planId,
          }),
          client.query<{
            setup_requirement_id: string;
            depends_on_requirement_id: string;
          }>(
            `SELECT setup_requirement_id, depends_on_requirement_id
               FROM platform.organization_setup_requirement_dependencies
              WHERE tenant_id = $1::uuid
                AND setup_plan_id = $2::uuid
              ORDER BY setup_requirement_id, depends_on_requirement_id`,
            [context.tenantId, planId],
          ),
          listVerifiedEnterpriseLegalEntities(client, {
            tenantId: context.tenantId,
            enterpriseId: context.enterpriseId,
          }),
          listOrganizationOperatingEntities(client, {
            tenantId: context.tenantId,
            organizationId: context.organizationId,
          }),
        ]);

        return {
          context,
          plan,
          requirements,
          dependencies: dependencyRows.rows.map((row) => ({
            requirementId: row.setup_requirement_id,
            dependsOnRequirementId: row.depends_on_requirement_id,
          })),
          verifiedLegalEntities,
          operatingEntities,
        };
      },
    );

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const denied = enterpriseSetupErrorResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
