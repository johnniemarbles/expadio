import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  listEnterpriseProfileConfigurationRequests,
  loadEnterpriseProfileConfiguration,
  requestEnterpriseProfileConfiguration,
} from '@expadio/postgres-runtime/enterprise-profile';
import {
  hasBrandGovernanceForOrganization,
  resolveBrandContext,
  withBrandTransaction,
} from '../../../../../lib/brand-context';

export async function GET() {
  try {
    const context = await resolveBrandContext();
    const result = await withBrandTransaction(context, async (client) => {
      const selected = await client.query<{
        enterprise_id: string;
        parent_organization_id: string | null;
        name: string;
        status: string;
      }>(
        `SELECT enterprise_id, parent_organization_id, name, status
           FROM platform.organizations
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
          LIMIT 1`,
        [context.tenantId, context.organizationId],
      );
      const row = selected.rows[0];
      if (!row) throw new Error('BRAND_ENTERPRISE_CONTEXT_NOT_FOUND');

      const profile = await loadEnterpriseProfileConfiguration(client, {
        tenantId: context.tenantId,
        enterpriseId: row.enterprise_id,
      });
      const rootName = profile.rootOrganizationId
        ? await client.query<{ name: string }>(
            `SELECT name
               FROM platform.organizations
              WHERE tenant_id = $1::uuid
                AND organization_id = $2::uuid
              LIMIT 1`,
            [context.tenantId, profile.rootOrganizationId],
          )
        : { rows: [] as { name: string }[] };

      const selectedIsRootCandidate =
        row.parent_organization_id === null && row.status === 'ACTIVE';
      const requests = selectedIsRootCandidate
        ? await listEnterpriseProfileConfigurationRequests(client, {
            tenantId: context.tenantId,
            enterpriseId: row.enterprise_id,
            rootOrganizationId: context.organizationId,
          })
        : [];

      return {
        profile,
        selectedOrganization: {
          organizationId: context.organizationId,
          name: row.name,
          status: row.status,
          parentOrganizationId: row.parent_organization_id,
          isRootCandidate: selectedIsRootCandidate,
        },
        rootOrganizationName: rootName.rows[0]?.name ?? null,
        requests,
      };
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'ENTERPRISE_PROFILE_CONFIGURATION_LOAD_FAILED',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const mode = body.mode === 'GLOBAL' ? 'GLOBAL' : body.mode === 'SIMPLE' ? 'SIMPLE' : null;
    if (!name || !mode) {
      return NextResponse.json(
        { error: 'Enterprise name and mode are required.' },
        { status: 400 },
      );
    }
    const idempotencyKey = request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header is required.' },
        { status: 400 },
      );
    }

    const outcome = await withBrandTransaction(context, async (client) => {
      if (
        !(await hasBrandGovernanceForOrganization(
          client,
          context.subjectId,
          context.organizationId,
        ))
      ) {
        return { denied: 'ENTERPRISE_PROFILE_CONFIGURATION_FORBIDDEN' } as const;
      }

      const selected = await client.query<{
        enterprise_id: string;
        parent_organization_id: string | null;
        status: string;
      }>(
        `SELECT enterprise_id, parent_organization_id, status
           FROM platform.organizations
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
          LIMIT 1`,
        [context.tenantId, context.organizationId],
      );
      const row = selected.rows[0];
      if (!row) throw new Error('BRAND_ENTERPRISE_CONTEXT_NOT_FOUND');
      if (row.parent_organization_id !== null || row.status !== 'ACTIVE') {
        return { denied: 'ENTERPRISE_PROFILE_ROOT_AUTHORITY_REQUIRED' } as const;
      }

      return requestEnterpriseProfileConfiguration(client, {
        tenantId: context.tenantId,
        enterpriseId: row.enterprise_id,
        rootOrganizationId: context.organizationId,
        name,
        mode,
        requestedBySubjectId: context.subjectId,
        correlationId:
          request.headers.get('x-correlation-id')?.trim() || randomUUID(),
        idempotencyKey,
      });
    });

    if ('denied' in outcome) {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: outcome.denied,
          message:
            outcome.denied === 'ENTERPRISE_PROFILE_ROOT_AUTHORITY_REQUIRED'
              ? 'Switch to an active top-level organization workspace to configure the enterprise profile.'
              : 'You are not authorized to configure this enterprise profile.',
        },
        { status: 403 },
      );
    }

    return NextResponse.json(outcome, {
      status: outcome.idempotent ? 200 : 202,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'ENTERPRISE_PROFILE_CONFIGURATION_REQUEST_FAILED';
    return NextResponse.json(
      {
        error: message,
        message:
          message === 'ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT'
            ? 'This request key was already used for different enterprise profile settings.'
            : 'The enterprise profile configuration request could not be created.',
      },
      { status: message === 'ENTERPRISE_IDEMPOTENCY_KEY_CONFLICT' ? 409 : 400 },
    );
  }
}
