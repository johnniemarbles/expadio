import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createEnterpriseTerritory } from '@expadio/postgres-runtime/enterprise-commercial';
import {
  deniedResponse,
  resolveRequestContext,
  withTenantTransaction,
} from '@/lib/request-context';
import { hasGovernanceWriteRoleForOrganization } from '@/lib/governance-authz';
import {
  enterpriseCommercialHttpError,
  resolveEnterpriseCommercialScope,
} from '@/lib/enterprise-commercial-context';

const KINDS = new Set(['GLOBAL','COUNTRY','SUBDIVISION','LOCALITY','CUSTOM']);

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    if (!context.organizationId) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED', message: 'Select an active governing organization.' },
        { status: 403 },
      );
    }
    const body = await request.json();
    if (!KINDS.has(body.territoryKind)) {
      return NextResponse.json({ error: 'Unsupported territory kind.' }, { status: 400 });
    }

    const result = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRoleForOrganization(client, context.subjectId, context.organizationId!))) {
        return { forbidden: true } as const;
      }
      const scope = await resolveEnterpriseCommercialScope(client, {
        tenantId: context.tenantId,
        organizationId: context.organizationId!,
      });
      return createEnterpriseTerritory(client, {
        tenantId: context.tenantId,
        enterpriseId: scope.enterpriseId,
        parentTerritoryId: typeof body.parentTerritoryId === 'string' ? body.parentTerritoryId : null,
        territoryKey: typeof body.territoryKey === 'string' ? body.territoryKey : '',
        name: typeof body.name === 'string' ? body.name : '',
        territoryKind: body.territoryKind,
        countryCode: typeof body.countryCode === 'string' ? body.countryCode : null,
        subdivisionCode: typeof body.subdivisionCode === 'string' ? body.subdivisionCode : null,
        localityName: typeof body.localityName === 'string' ? body.localityName : null,
        externalGeographyRef:
          typeof body.externalGeographyRef === 'string' ? body.externalGeographyRef : null,
        createdBySubjectId: context.subjectId,
        correlationId: request.headers.get('x-correlation-id')?.trim() || randomUUID(),
      });
    });
    if ('forbidden' in result) {
      return NextResponse.json(
        { denied: true, reasonKey: 'ENTERPRISE_TERRITORY_FORBIDDEN', message: 'You are not authorized to manage enterprise territories.' },
        { status: 403 },
      );
    }
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    const mapped = enterpriseCommercialHttpError(error);
    if (mapped.status !== 500) return NextResponse.json(mapped.body, { status: mapped.status });
    const denied = deniedResponse(error);
    return NextResponse.json(denied.body, { status: denied.status });
  }
}
