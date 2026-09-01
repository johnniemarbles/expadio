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

export const COMMUNICATION_CAPABILITIES: readonly { key: string; name: string }[] = [
  { key: 'communication.email.send', name: 'Email — Send' },
  { key: 'communication.sms.send', name: 'SMS — Send' },
  { key: 'communication.whatsapp.send', name: 'WhatsApp — Send' },
  { key: 'communication.voice.dial', name: 'Voice — Dial' },
  { key: 'communication.push.send', name: 'Push — Send' },
  { key: 'communication.rcs.send', name: 'RCS — Send' },
  { key: 'communication.social.send', name: 'Social — Send' },
];

export const membershipRepository = new PostgresMembershipRepository(dbPool);
export const identityVerifier = new ClerkIdentityVerifier();
