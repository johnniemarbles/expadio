import { auth } from '@clerk/nextjs/server';
import { dbPool } from './iam-adapter';
import { parseTenantScope, tenantErrorResponse, TenantReadError, withTenantRead } from './tenant-read-model';
import type { SqlClient } from './tenant-read-model';
import type { TenantContext, TenantIdentity } from './tenant-contracts';

export async function tenantGET(request: Request, read: (client: SqlClient, identity: TenantIdentity, context: TenantContext, url: URL) => Promise<unknown>) {
  try {
    const { userId } = await auth();
    if (!userId) throw new TenantReadError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    const url = new URL(request.url);
    const identity = { ...parseTenantScope(url), subjectId: userId };
    const data = await withTenantRead(dbPool, identity, (client, context) => read(client, identity, context, url));
    return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return tenantErrorResponse(error); }
}
