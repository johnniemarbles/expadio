import { clerkClient } from '@clerk/nextjs/server';
import type { IdentityVerifier, VerifiedIdentity, IdentityVerificationRequest } from '@expadio/iam';
import pg from 'pg';
import { PostgresMembershipRepository } from '@expadio/postgres-runtime';

export class ClerkIdentityVerifier implements IdentityVerifier {
  async verify(request: IdentityVerificationRequest): Promise<VerifiedIdentity> {
    const userId = request.credential; // In this setup, we pass userId directly
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    
    return {
      providerKey: userId,
      subjectId: userId,
      issuer: 'https://clerk.expadio.com',
      actorKind: 'user'
    };
  }
}

// Global pool to prevent exhausting connections in dev
declare global {
  var _dbPool: pg.Pool | undefined;
}

export const dbPool = global._dbPool || new pg.Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432'),
        user: process.env.PGUSER || 'expadio',
        password: process.env.PGPASSWORD || 'expadio_password',
        database: process.env.PGDATABASE || 'expadio',
      }
);

if (process.env.NODE_ENV === 'development') {
  global._dbPool = dbPool;
}

import type { IdentityContext, MembershipContext } from '@expadio/tenancy';

export interface MembershipRepository {
  listActiveMemberships(identity: IdentityContext): Promise<readonly MembershipContext[]>;
}

export class AutoProvisioningMembershipRepository implements MembershipRepository {
  constructor(private readonly inner: MembershipRepository, private readonly pool: pg.Pool) {}

  async listActiveMemberships(identity: IdentityContext): Promise<readonly MembershipContext[]> {
    let list = await this.inner.listActiveMemberships(identity);
    if (list.length === 0 && identity.subjectId) {
      try {
        const client = await this.pool.connect();
        try {
          await client.query(
            `INSERT INTO platform.memberships (tenant_id, organization_id, subject_id, actor_kind, status, issuer, workspace_scope_mode, operating_unit_scope_mode)
             VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', $1, 'user', 'ACTIVE', 'https://clerk.expadio.com', 'ALL', 'ALL')
             ON CONFLICT (tenant_id, subject_id) DO UPDATE SET status = 'ACTIVE', issuer = 'https://clerk.expadio.com'`,
            [identity.subjectId]
          );
        } finally {
          client.release();
        }
        list = await this.inner.listActiveMemberships(identity);
      } catch (err) {
        console.error('Error auto-provisioning membership:', err);
      }
    }
    return list;
  }
}

export const membershipRepository = new AutoProvisioningMembershipRepository(
  new PostgresMembershipRepository(dbPool),
  dbPool
);
export const identityVerifier = new ClerkIdentityVerifier();
