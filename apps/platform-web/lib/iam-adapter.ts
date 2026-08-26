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
      subjectId: user.primaryEmailAddress?.emailAddress ?? userId,
      issuer: 'clerk',
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

export const membershipRepository = new PostgresMembershipRepository(dbPool);
export const identityVerifier = new ClerkIdentityVerifier();
