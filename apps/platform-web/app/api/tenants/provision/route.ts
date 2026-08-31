import { auth } from '@clerk/nextjs/server';
import {
  parsePlatformProvisionInput,
  platformProvisionResult,
  ScopeMappingError,
} from '@expadio/tenancy';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';
import {
  PLATFORM_PRODUCT_CACHE,
  assertPlatformProductPayload,
  platformProductDenied,
} from '../../../../lib/platform-product-surface';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json(platformProductDenied('UNAUTHENTICATED'), {
      status: 401,
      headers: PLATFORM_PRODUCT_CACHE,
    });
  }

  try {
    await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      {
        credential: userId,
        tenantId: '00000000-0000-0000-0000-000000000001',
        organizationId: '00000000-0000-0000-0000-000000000002',
      },
    );

    const body = (await request.json()) as Record<string, unknown>;
    const command = parsePlatformProvisionInput({
      tenantCode: String(body.tenantCode ?? ''),
      brandCode: String(body.brandCode ?? ''),
      locationCode: String(body.locationCode ?? ''),
      tenantLabel: typeof body.tenantLabel === 'string' ? body.tenantLabel : undefined,
      organizationLabel: typeof body.organizationLabel === 'string' ? body.organizationLabel : undefined,
      locationLabel: typeof body.locationLabel === 'string' ? body.locationLabel : undefined,
      createTenant: body.createTenant === true,
    });

    const result = await dbPool.query(
      `SELECT tenant_code, brand_code, location_code, tenant_id, organization_id, operating_unit_id
         FROM platform.provision_product_scope($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        command.tenantCode,
        command.brandCode,
        command.locationCode,
        command.tenantLabel,
        command.organizationLabel,
        command.locationLabel,
        command.createTenant,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      return Response.json(platformProductDenied('PROVISION_FAILED'), {
        status: 500,
        headers: PLATFORM_PRODUCT_CACHE,
      });
    }

    const payload = platformProvisionResult(row);
    assertPlatformProductPayload(payload);
    return Response.json(payload, { status: 200, headers: PLATFORM_PRODUCT_CACHE });
  } catch (error) {
    if (error instanceof ScopeMappingError) {
      return Response.json(platformProductDenied(error.code), {
        status: 400,
        headers: PLATFORM_PRODUCT_CACHE,
      });
    }
    const message = error instanceof Error ? error.message : '';
    const known =
      message === 'NO_MEMBERSHIP' ||
      message === 'INVALID_PRODUCT_SCOPE_CODE' ||
      message === 'TENANT_OUT_OF_SCOPE' ||
      message === 'BINDING_CONFLICT' ||
      message === 'TENANT_CODE_CONFLICT' ||
      message === 'BRAND_OWNERSHIP_CONFLICT';
    return Response.json(platformProductDenied(known ? message : 'INTERNAL_ERROR'), {
      status: known ? 409 : 500,
      headers: PLATFORM_PRODUCT_CACHE,
    });
  }
}
