import { clerkClient } from '@clerk/nextjs/server';
import type { IdentityVerifier, VerifiedIdentity, IdentityVerificationRequest } from '@expadio/iam';
import pg from 'pg';
import { PostgresMembershipRepository } from '@expadio/postgres-runtime';
import { shouldGrantPlatformAdmin } from './admin-grant.ts';

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

const DEMO_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEMO_ORG_ID = '00000000-0000-0000-0000-000000000002';

export class AutoProvisioningMembershipRepository implements MembershipRepository {
  // Subjects whose platform-admin grant has already been ensured this process
  // lifetime, so the idempotent grant runs at most once per subject per pod.
  private readonly grantedSubjects = new Set<string>();

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

    // Admin role grant, now gated rather than unconditional (was: every logged-in
    // operator silently became PLATFORM_SUPER_ADMIN). Governance:
    //   - PLATFORM_ADMIN_SUBJECTS: an explicit allowlist of subject ids that get
    //     the platform-admin + tenant-owner grant. This is the production path.
    //   - DEMO_OPEN_ADMIN (default "true"): when true, any provisioned operator
    //     is granted, keeping the single-tenant demo console usable end to end.
    //     Set DEMO_OPEN_ADMIN=false in production to require the allowlist.
    // Idempotent and cached per process so the decision runs once per operator.
    if (identity.subjectId && list.length > 0 && !this.grantedSubjects.has(identity.subjectId)) {
      this.grantedSubjects.add(identity.subjectId);
      if (shouldGrantPlatformAdmin(identity.subjectId)) {
        try {
          await this.ensurePlatformAdmin(identity.subjectId);
        } catch (err) {
          console.error('Error ensuring platform-admin role:', err);
        }
      }
    }

    return list;
  }

  private async ensurePlatformAdmin(subjectId: string): Promise<void> {
    await ensureGlobalBootstrap(this.pool);
    const client = await this.pool.connect();
    try {
      // Grant both the platform-admin role (platform-scoped governance: template
      // authoring/publication) and the tenant-owner role (tenant-scoped actions
      // such as cloning a platform template into a brand draft).
      await client.query(
        `INSERT INTO platform.authorization_assignments (tenant_id, organization_id, subject_id, role_id, status)
         SELECT $1::uuid, $2::uuid, $3, r.role_id, 'ACTIVE'
           FROM platform.authorization_roles r
          WHERE (
                  (r.role_key = 'PLATFORM_SUPER_ADMIN' AND r.tenant_id IS NULL)
                  OR (r.role_key = 'TENANT_OWNER' AND r.tenant_id = $1::uuid)
                )
            AND NOT EXISTS (
              SELECT 1 FROM platform.authorization_assignments a
               WHERE a.subject_id = $3 AND a.role_id = r.role_id AND a.tenant_id = $1::uuid
            )`,
        [DEMO_TENANT_ID, DEMO_ORG_ID, subjectId],
      );
    } finally {
      client.release();
    }
  }
}

// Canonical communication capabilities the provider-registration flow references.
// The register step validates connector capability keys against this table, so
// without these rows no communication connector can be created. Seeded here (and
// in scripts/seed.cjs) so the live console works without a manual re-seed.
export const COMMUNICATION_CAPABILITIES: readonly { key: string; name: string }[] = [
  { key: 'communication.email.send', name: 'Email — Send' },
  { key: 'communication.sms.send', name: 'SMS — Send' },
  { key: 'communication.whatsapp.send', name: 'WhatsApp — Send' },
  { key: 'communication.voice.dial', name: 'Voice — Dial' },
  { key: 'communication.push.send', name: 'Push — Send' },
  { key: 'communication.rcs.send', name: 'RCS — Send' },
  { key: 'communication.social.send', name: 'Social — Send' },
];

let globalBootstrapPromise: Promise<void> | undefined;

/**
 * One-time, idempotent process bootstrap of the platform-scoped rows the
 * console depends on: the PLATFORM_SUPER_ADMIN role and the communication
 * capability registry. Runs once per pod; safe to call concurrently.
 */
function ensureGlobalBootstrap(pool: pg.Pool): Promise<void> {
  if (globalBootstrapPromise === undefined) {
    globalBootstrapPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO platform.authorization_roles (role_key, display_name, ownership_scope, tenant_id, status)
           VALUES ('PLATFORM_SUPER_ADMIN', 'Platform Super Admin', 'PLATFORM', NULL, 'ACTIVE')
           ON CONFLICT (role_key) WHERE tenant_id IS NULL DO NOTHING`,
        );
        await client.query(
          `INSERT INTO platform.authorization_roles (role_key, display_name, ownership_scope, tenant_id, status)
           VALUES ('TENANT_OWNER', 'Tenant Owner', 'TENANT', $1::uuid, 'ACTIVE')
           ON CONFLICT (tenant_id, role_key) WHERE tenant_id IS NOT NULL DO NOTHING`,
          [DEMO_TENANT_ID],
        );
        for (const capability of COMMUNICATION_CAPABILITIES) {
          await client.query(
            `INSERT INTO platform.capabilities (capability_key, display_name, permitted_modes, enabled)
             VALUES ($1, $2, ARRAY['A']::text[], true)
             ON CONFLICT (capability_key) DO NOTHING`,
            [capability.key, capability.name],
          );
        }
      } finally {
        client.release();
      }
    })().catch((err) => {
      // Reset so a transient failure can be retried on the next request.
      globalBootstrapPromise = undefined;
      throw err;
    });
  }
  return globalBootstrapPromise;
}

export const membershipRepository = new AutoProvisioningMembershipRepository(
  new PostgresMembershipRepository(dbPool),
  dbPool
);
export const identityVerifier = new ClerkIdentityVerifier();
