import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../lib/request-context';
import { hasCrmWriteRole } from '../../../../lib/crm-authz';
import { grantAuthority, resolveAuthorityGrants } from '../../../../lib/workflow-authority-grants';

/**
 * Approval-authority grants for the tenant. A governing role may grant a subject
 * authority on a dimension (e.g. a monetary approval ceiling), optionally scoped
 * to an organization and optionally delegated from a principal. Tenant-scoped by
 * RLS. GET lists a subject's grants; POST records one.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const subjectId = new URL(request.url).searchParams.get('subjectId')?.trim() ?? '';
    if (subjectId === '') {
      return NextResponse.json({ error: 'A subjectId is required.' }, { status: 400 });
    }
    const grants = await withTenantClient(context, (client) => resolveAuthorityGrants(client, subjectId));
    return NextResponse.json({ subjectId, grants });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveRequestContext(request);
    const body = await request.json();

    const subjectId = typeof body?.subjectId === 'string' ? body.subjectId.trim() : '';
    const dimensionKey = typeof body?.dimensionKey === 'string' ? body.dimensionKey.trim() : '';
    if (subjectId === '' || dimensionKey === '') {
      return NextResponse.json({ error: 'subjectId and dimensionKey are required.' }, { status: 400 });
    }

    let thresholdMinorUnits: number | null = null;
    if (body?.thresholdMinorUnits !== undefined && body.thresholdMinorUnits !== null && body.thresholdMinorUnits !== '') {
      const n = Number(body.thresholdMinorUnits);
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json({ error: 'thresholdMinorUnits must be a non-negative whole number.' }, { status: 400 });
      }
      thresholdMinorUnits = n;
    }
    const currency = typeof body?.currency === 'string' && /^[A-Za-z]{3}$/.test(body.currency) ? body.currency.toUpperCase() : null;
    const scopeType = body?.scopeType === 'ORGANIZATION' ? 'ORGANIZATION' : 'TENANT';
    const scopeEntityId = scopeType === 'ORGANIZATION' && typeof body?.scopeEntityId === 'string' && body.scopeEntityId.trim() !== ''
      ? body.scopeEntityId.trim()
      : null;
    if (scopeType === 'ORGANIZATION' && scopeEntityId === null) {
      return NextResponse.json({ error: 'An ORGANIZATION-scoped grant requires scopeEntityId.' }, { status: 400 });
    }
    const delegatedFromSubjectId = typeof body?.delegatedFromSubjectId === 'string' && body.delegatedFromSubjectId.trim() !== ''
      ? body.delegatedFromSubjectId.trim()
      : null;

    const result = await withTenantClient(context, async (client) => {
      if (!(await hasCrmWriteRole(client, context.subjectId))) {
        return { forbidden: true } as const;
      }
      const grant = await grantAuthority(client, {
        tenantId: context.tenantId,
        subjectId,
        dimensionKey,
        thresholdMinorUnits,
        currency,
        scopeType,
        scopeEntityId,
        delegatedFromSubjectId,
        grantedBySubjectId: context.subjectId,
      });
      return { grant } as const;
    });

    if ('forbidden' in result) {
      return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'You need a tenant admin role to grant authority.' }, { status: 403 });
    }
    return NextResponse.json({ success: true, grantId: result.grant.grantId }, { status: 201 });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
