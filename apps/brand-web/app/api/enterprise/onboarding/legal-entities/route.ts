import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  createEnterpriseLegalEntityIntake,
  searchEnterpriseLegalEntities,
} from '@expadio/postgres-runtime/enterprise-legal';
import {
  hasBrandGovernanceForOrganization,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../lib/brand-context';

async function enterpriseIdForContext(
  client: import('pg').PoolClient,
  tenantId: string,
  organizationId: string,
): Promise<string> {
  const result = await client.query<{ enterprise_id: string }>(
    `SELECT enterprise_id
       FROM platform.organizations
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
      LIMIT 1`,
    [tenantId, organizationId],
  );
  const enterpriseId = result.rows[0]?.enterprise_id;
  if (!enterpriseId) throw new Error('ENTERPRISE_PROFILE_NOT_FOUND');
  return enterpriseId;
}

export async function GET(request: Request) {
  try {
    const context = await resolveBrandContext();
    const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
    const matches = await withBrandTransaction(context, async (client) => {
      const enterpriseId = await enterpriseIdForContext(
        client,
        context.tenantId,
        context.organizationId,
      );
      return searchEnterpriseLegalEntities(client, {
        tenantId: context.tenantId,
        enterpriseId,
        query,
      });
    });
    return NextResponse.json({ matches }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'ENTERPRISE_LEGAL_SEARCH_FAILED' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json();
    const result = await withBrandTransaction(context, async (client) => {
      if (
        !(await hasBrandGovernanceForOrganization(
          client,
          context.subjectId,
          context.organizationId,
        ))
      ) {
        return { denied: 'ENTERPRISE_LEGAL_ENTITY_CREATE_FORBIDDEN' } as const;
      }
      const enterpriseId = await enterpriseIdForContext(
        client,
        context.tenantId,
        context.organizationId,
      );
      return createEnterpriseLegalEntityIntake(client, {
        tenantId: context.tenantId,
        enterpriseId,
        legalName: typeof body.legalName === 'string' ? body.legalName : '',
        entityType: typeof body.entityType === 'string' ? body.entityType : 'CORPORATION',
        countryCode: typeof body.countryCode === 'string' ? body.countryCode : '',
        subdivisionCode: typeof body.subdivisionCode === 'string' ? body.subdivisionCode : null,
        registrationJurisdictionCode:
          typeof body.registrationJurisdictionCode === 'string'
            ? body.registrationJurisdictionCode
            : '',
        registrationType:
          typeof body.registrationType === 'string' ? body.registrationType : '',
        registrationValue:
          typeof body.registrationValue === 'string' ? body.registrationValue : '',
        actorSubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
    });

    if ('denied' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: result.denied, message: 'You are not authorized to submit a legal entity.' },
        { status: 403 },
      );
    }
    return NextResponse.json(result, { status: result.idempotent ? 200 : 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ENTERPRISE_LEGAL_ENTITY_CREATE_FAILED';
    return NextResponse.json(
      {
        error: message,
        message:
          message === 'ENTERPRISE_LEGAL_ENTITY_ALREADY_EXISTS'
            ? 'A legal entity already exists for that registration identity. Use Search Before Create.'
            : 'The legal entity could not be submitted for verification.',
      },
      { status: message === 'ENTERPRISE_LEGAL_ENTITY_ALREADY_EXISTS' ? 409 : 400 },
    );
  }
}
