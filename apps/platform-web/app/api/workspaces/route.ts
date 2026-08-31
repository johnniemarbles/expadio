import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../lib/iam-adapter';
import {
  PLATFORM_PRODUCT_CACHE,
  SHELL_PLATFORM_SECTIONS,
  assertPlatformProductPayload,
  assertPlatformSectionsMatchContract,
  platformProductDenied,
} from '../../../lib/platform-product-surface';

export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(platformProductDenied('UNAUTHENTICATED'), {
      status: 401,
      headers: PLATFORM_PRODUCT_CACHE,
    });
  }

  const resolve = () => authenticateAndResolveContext(
    { identityVerifier, membershipRepository },
    {
      credential: userId,
      tenantId: '00000000-0000-0000-0000-000000000001',
      organizationId: '00000000-0000-0000-0000-000000000002',
    },
  );

  try {
    assertPlatformSectionsMatchContract();
    try {
      await resolve();
    } catch {
      const client = await dbPool.connect();
      try {
        const res = await client.query('SELECT membership_id FROM platform.memberships WHERE subject_id = $1', [userId]);
        if (res.rowCount === 0) {
          await client.query(
            `INSERT INTO platform.memberships (tenant_id, organization_id, subject_id, actor_kind, status, issuer, workspace_scope_mode, operating_unit_scope_mode)
             VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', $1, 'user', 'ACTIVE', 'https://clerk.expadio.com', 'ALL', 'ALL')`,
            [userId],
          );
        } else {
          await client.query("UPDATE platform.memberships SET issuer = 'https://clerk.expadio.com' WHERE subject_id = $1", [userId]);
        }
      } finally {
        client.release();
      }
      await resolve();
    }

    assertPlatformProductPayload(SHELL_PLATFORM_SECTIONS);
    return NextResponse.json(SHELL_PLATFORM_SECTIONS, { headers: PLATFORM_PRODUCT_CACHE });
  } catch (error) {
    const reason =
      error instanceof Error && error.message === 'PLATFORM_PII_BOUNDARY'
        ? 'PLATFORM_PII_BOUNDARY'
        : 'UNAUTHORIZED_OR_UNMAPPED';
    return NextResponse.json(platformProductDenied(reason), {
      status: reason === 'PLATFORM_PII_BOUNDARY' ? 500 : 403,
      headers: PLATFORM_PRODUCT_CACHE,
    });
  }
}
