import { NextResponse } from 'next/server';
import { IndustryPackRuntimeResolutionError } from '@expadio/industry-packs';
import { PostgresIndustryPackVersionRepository } from '@expadio/postgres-runtime/industry-pack-authoring';
import { PostgresIndustryPackRuntimeResolver } from '@expadio/postgres-runtime/industry-pack-runtime';
import {
  resolveRequestContext,
  withTenantTransaction,
  deniedResponse,
} from '../../../../../../lib/request-context';
import { hasGovernanceWriteRole } from '../../../../../../lib/governance-authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Create a tenant DRAFT from the workspace's currently resolved Industry Pack.
 *
 * This is intentionally narrower than raw definition authoring: an admin can
 * begin from the exact runtime baseline without copying JSON or guessing which
 * persisted/code version currently governs new business objects.
 */
export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);

    const outcome = await withTenantTransaction(context, async (client) => {
      if (!(await hasGovernanceWriteRole(client, context.subjectId))) {
        return { kind: 'FORBIDDEN' as const };
      }

      const tenant = await client.query(
        `SELECT vertical_key
           FROM platform.tenants
          WHERE tenant_id = $1::uuid
          FOR UPDATE`,
        [context.tenantId],
      );
      const verticalKey = tenant.rows[0]?.vertical_key ?? null;
      if (verticalKey === null) {
        return { kind: 'NO_ACTIVE_PACK' as const };
      }

      let resolved;
      try {
        resolved = await new PostgresIndustryPackRuntimeResolver(client).resolve({
          tenantId: context.tenantId,
          verticalKey,
        });
      } catch (error) {
        if (error instanceof IndustryPackRuntimeResolutionError) {
          return { kind: 'RUNTIME_NOT_FOUND' as const };
        }
        throw error;
      }

      if (resolved.pack === null || resolved.provenance.verticalKey === null) {
        return { kind: 'NO_ACTIVE_PACK' as const };
      }

      const repository = new PostgresIndustryPackVersionRepository(client);
      const draft = await repository.createDraft({
        scope: { type: 'TENANT', tenantId: context.tenantId },
        verticalKey: resolved.provenance.verticalKey,
        definition: resolved.pack,
        createdBySubjectId: context.subjectId,
        ...(resolved.provenance.source === 'TENANT_PUBLISHED'
          && resolved.provenance.version !== null
          ? {
              parent: {
                verticalKey: resolved.provenance.verticalKey,
                version: resolved.provenance.version,
              },
            }
          : {}),
      });

      return {
        kind: 'CREATED' as const,
        draft,
        clonedFrom: resolved.provenance,
      };
    });

    if (outcome.kind === 'FORBIDDEN') {
      return NextResponse.json(
        {
          denied: true,
          reasonKey: 'FORBIDDEN',
          message: 'You need a governing role to create Industry Pack drafts.',
        },
        { status: 403 },
      );
    }
    if (outcome.kind === 'NO_ACTIVE_PACK') {
      return NextResponse.json(
        {
          error: 'The workspace has no active Industry Pack to clone.',
          reasonKey: 'INDUSTRY_PACK_ACTIVE_BINDING_REQUIRED',
        },
        { status: 409 },
      );
    }
    if (outcome.kind === 'RUNTIME_NOT_FOUND') {
      return NextResponse.json(
        {
          error: 'The active Industry Pack could not be resolved.',
          reasonKey: 'INDUSTRY_PACK_RUNTIME_NOT_FOUND',
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        draft: outcome.draft,
        clonedFrom: outcome.clonedFrom,
      },
      { status: 201 },
    );
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
