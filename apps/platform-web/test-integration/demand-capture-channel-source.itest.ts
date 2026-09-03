import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { generatePublishableKey } from '../lib/lead-capture-public-source.ts';

// Behavioral proof for migration 0134: the trust-rail invariants are enforced by
// the database itself, not merely described in application code. Runs against a
// migrated PostgreSQL (expadio_test) as a superuser — CHECK constraints and
// unique indexes apply regardless of role.

function connectInfo() {
  return {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? 'expadio_test',
  };
}

function superuserPool(): pg.Pool {
  return new pg.Pool({
    ...connectInfo(),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    max: 1,
  });
}

async function seedOrganization(c: pg.PoolClient, tenantId: string): Promise<string> {
  const organizationId = randomUUID();
  await c.query(`INSERT INTO platform.tenants (tenant_id, name) VALUES ($1, 'Capture Tenant') ON CONFLICT DO NOTHING`, [tenantId]);
  await c.query(
    `INSERT INTO platform.organizations (organization_id, tenant_id, parent_organization_id, name)
     VALUES ($1, $2, NULL, $3)`,
    [organizationId, tenantId, 'Capture Org'],
  );
  return organizationId;
}

type Overrides = {
  source_key?: string;
  surface?: string;
  require_signed_ticket?: boolean;
  verification_public_key?: string | null;
  verification_key_id?: string | null;
  channel?: string;
  trust_rail?: string;
  publishable_key?: string | null;
  allowed_origins?: string[];
};

async function insertSource(
  c: pg.PoolClient,
  tenantId: string,
  organizationId: string,
  o: Overrides = {},
): Promise<void> {
  const requireSigned = o.require_signed_ticket ?? true;
  await c.query(
    `INSERT INTO platform.lead_capture_sources
       (tenant_id, organization_id, source_key, surface, require_signed_ticket, status,
        verification_algorithm, verification_public_key, verification_key_id,
        channel, trust_rail, publishable_key, allowed_origins)
     VALUES ($1,$2,$3,$4,$5,'ACTIVE','ED25519',$6,$7,$8,$9,$10,$11)`,
    [
      tenantId,
      organizationId,
      o.source_key ?? `src-${randomUUID().slice(0, 12)}`,
      o.surface ?? 'FORM',
      requireSigned,
      o.verification_public_key ?? (requireSigned ? 'PUBKEY-PEM' : null),
      o.verification_key_id ?? (requireSigned ? 'ed25519:test' : null),
      o.channel ?? 'WEB',
      o.trust_rail ?? 'SIGNED',
      o.publishable_key ?? null,
      o.allowed_origins ?? [],
    ],
  );
}

async function expectReject(fn: () => Promise<unknown>, needle: RegExp): Promise<void> {
  try {
    await fn();
    assert.fail('expected the write to be rejected');
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    const message = String((error as { message?: string }).message ?? error);
    assert.match(message, needle);
  }
}

test('signed sources persist with a verification key and no browser credentials', async () => {
  const pool = superuserPool();
  const c = await pool.connect();
  try {
    const tenantId = randomUUID();
    const org = await seedOrganization(c, tenantId);
    await insertSource(c, tenantId, org, { surface: 'API', channel: 'API', trust_rail: 'SIGNED' });
  } finally {
    c.release();
    await pool.end();
  }
});

test('public sources persist with a publishable key and origin allowlist', async () => {
  const pool = superuserPool();
  const c = await pool.connect();
  try {
    const tenantId = randomUUID();
    const org = await seedOrganization(c, tenantId);
    await insertSource(c, tenantId, org, {
      trust_rail: 'PUBLIC',
      require_signed_ticket: false,
      publishable_key: generatePublishableKey(),
      allowed_origins: ['https://example.com'],
    });
  } finally {
    c.release();
    await pool.end();
  }
});

test('rail invariants reject inconsistent sources', async () => {
  const pool = superuserPool();
  const c = await pool.connect();
  try {
    const tenantId = randomUUID();
    const org = await seedOrganization(c, tenantId);

    // PUBLIC without a publishable key.
    await expectReject(() => insertSource(c, tenantId, org, {
      trust_rail: 'PUBLIC',
      require_signed_ticket: false,
      allowed_origins: ['https://example.com'],
    }), /rail_consistent/);

    // PUBLIC that still demands a signed ticket it can never produce.
    await expectReject(() => insertSource(c, tenantId, org, {
      trust_rail: 'PUBLIC',
      require_signed_ticket: true,
      publishable_key: generatePublishableKey(),
      allowed_origins: ['https://example.com'],
    }), /rail_consistent/);

    // SIGNED carrying a browser publishable key.
    await expectReject(() => insertSource(c, tenantId, org, {
      trust_rail: 'SIGNED',
      require_signed_ticket: true,
      publishable_key: generatePublishableKey(),
    }), /rail_consistent/);
  } finally {
    c.release();
    await pool.end();
  }
});

test('publishable keys are unique, well-formed, and origins are non-empty', async () => {
  const pool = superuserPool();
  const c = await pool.connect();
  try {
    const tenantId = randomUUID();
    const org = await seedOrganization(c, tenantId);

    const shared = generatePublishableKey();
    await insertSource(c, tenantId, org, {
      trust_rail: 'PUBLIC', require_signed_ticket: false,
      publishable_key: shared, allowed_origins: ['https://a.example'],
    });
    await expectReject(() => insertSource(c, tenantId, org, {
      trust_rail: 'PUBLIC', require_signed_ticket: false,
      publishable_key: shared, allowed_origins: ['https://b.example'],
    }), /publishable_key_uq|duplicate key/);

    await expectReject(() => insertSource(c, tenantId, org, {
      trust_rail: 'PUBLIC', require_signed_ticket: false,
      publishable_key: 'not-a-valid-key', allowed_origins: ['https://c.example'],
    }), /publishable_key_format/);

    await expectReject(() => insertSource(c, tenantId, org, {
      trust_rail: 'PUBLIC', require_signed_ticket: false,
      publishable_key: generatePublishableKey(), allowed_origins: [''],
    }), /allowed_origins_bounded/);
  } finally {
    c.release();
    await pool.end();
  }
});

test('channel is bounded to the known set', async () => {
  const pool = superuserPool();
  const c = await pool.connect();
  try {
    const tenantId = randomUUID();
    const org = await seedOrganization(c, tenantId);
    await expectReject(
      () => insertSource(c, tenantId, org, { channel: 'CARRIER_PIGEON' }),
      /channel/,
    );
  } finally {
    c.release();
    await pool.end();
  }
});
