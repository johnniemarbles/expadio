import { auth } from '@clerk/nextjs/server';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';
import {
  PLATFORM_PRODUCT_CACHE,
  assertPlatformProductPayload,
  platformProductDenied,
} from '../../../../lib/platform-product-surface';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json(platformProductDenied('UNAUTHENTICATED'), {
      status: 401,
      headers: PLATFORM_PRODUCT_CACHE,
    });
  }

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      {
        credential: userId,
        tenantId: '00000000-0000-0000-0000-000000000001',
        organizationId: '00000000-0000-0000-0000-000000000002',
      },
    );

    const result = await dbPool.query(
      `SELECT o.organization_id, o.name, o.status, o.created_at, COUNT(m.membership_id)::int as members
         FROM platform.organizations o
         LEFT JOIN platform.memberships m ON o.organization_id = m.organization_id
        WHERE o.tenant_id = $1
        GROUP BY o.organization_id, o.name, o.status, o.created_at
        ORDER BY o.name ASC`,
      [effectiveContext.tenantId],
    );
    assertPlatformProductPayload(result.rows);
    return Response.json(result.rows, { headers: PLATFORM_PRODUCT_CACHE });
  } catch {
    return Response.json(platformProductDenied('INTERNAL_ERROR'), {
      status: 500,
      headers: PLATFORM_PRODUCT_CACHE,
    });
  }
}
