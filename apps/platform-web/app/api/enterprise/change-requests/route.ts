import { NextResponse } from 'next/server';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '../../../../lib/request-context';
import { membershipRepository } from '../../../../lib/iam-adapter';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const memberships = await membershipRepository.listActiveMemberships({
      subjectId: context.subjectId,
      issuer: context.issuer ?? undefined,
      actorKind: 'user',
    } as any);
    const allowedOrganizationIds = [
      ...new Set(
        memberships
          .filter((membership) => membership.tenantId === context.tenantId)
          .map((membership) => membership.organizationId),
      ),
    ];

    const rows = await withTenantTransaction(context, async (client) => {
      if (allowedOrganizationIds.length === 0) return [];
      const result = await client.query(
        `SELECT
           enterprise_change_request_id,
           operation,
           requesting_organization_id,
           approving_organization_id,
           target_organization_id,
           target_legal_entity_id,
           status,
           proposed_payload,
           requested_by_subject_id,
           requested_at,
           decided_by_subject_id,
           decided_at,
           decision_reason,
           correlation_id
         FROM platform.enterprise_change_requests
         WHERE tenant_id = $1::uuid
           AND (
             requesting_organization_id = ANY($2::uuid[])
             OR approving_organization_id = ANY($2::uuid[])
           )
         ORDER BY requested_at DESC, enterprise_change_request_id DESC`,
        [context.tenantId, allowedOrganizationIds],
      );
      return result.rows;
    });

    return NextResponse.json(rows, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
