import { createHash, createPublicKey } from 'node:crypto';
import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SURFACES = new Set(['FORM', 'WEBHOOK', 'API']);

function normalizePublicKey(raw: unknown): { pem: string; keyId: string } {
  if (typeof raw !== 'string' || raw.length > 8192) throw new Error('VERIFICATION_KEY_REQUIRED');
  const key = createPublicKey(raw.trim());
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('VERIFICATION_KEY_MUST_BE_ED25519');
  const pem = key.export({ type: 'spki', format: 'pem' }).toString();
  const der = key.export({ type: 'spki', format: 'der' });
  const keyId = `ed25519:${createHash('sha256').update(der).digest('hex').slice(0, 24)}`;
  return { pem, keyId };
}

export async function GET() {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    return await withBrandTransaction(context, async (client) => {
      const result = await client.query(
        `SELECT source_id, source_key, surface, layer_key, status,
                verification_algorithm, verification_key_id, max_clock_skew_seconds,
                created_at, updated_at
           FROM platform.lead_capture_sources
          WHERE tenant_id = $1::uuid AND organization_id = $2::uuid
          ORDER BY source_key`,
        [context.tenantId, context.organizationId],
      );
      return NextResponse.json(result.rows.map((row) => ({
        sourceId: row.source_id,
        sourceKey: row.source_key,
        surface: row.surface,
        layerKey: row.layer_key,
        status: row.status,
        verificationAlgorithm: row.verification_algorithm,
        verificationKeyId: row.verification_key_id,
        maxClockSkewSeconds: row.max_clock_skew_seconds,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      })));
    });
  } catch (error) {
    console.error('Brand capture source read failed:', error);
    return NextResponse.json({ error: 'Unable to load capture sources.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    if (!context.organizationId) {
      return NextResponse.json({ denied: true, reasonKey: 'ORGANIZATION_CONTEXT_REQUIRED' }, { status: 403 });
    }
    const body = await request.json();
    const sourceKey = typeof body.sourceKey === 'string' ? body.sourceKey.trim().toLowerCase() : '';
    const surface = typeof body.surface === 'string' ? body.surface.trim().toUpperCase() : '';
    const layerKey = typeof body.layerKey === 'string' && body.layerKey.trim() ? body.layerKey.trim() : null;
    const maxClockSkewSeconds = body.maxClockSkewSeconds === undefined ? 300 : Number(body.maxClockSkewSeconds);
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/u.test(sourceKey)) {
      return NextResponse.json({ error: 'sourceKey must be 3-80 safe characters.' }, { status: 400 });
    }
    if (!SURFACES.has(surface)) return NextResponse.json({ error: 'Unsupported capture surface.' }, { status: 400 });
    if (!Number.isInteger(maxClockSkewSeconds) || maxClockSkewSeconds < 30 || maxClockSkewSeconds > 3600) {
      return NextResponse.json({ error: 'maxClockSkewSeconds must be between 30 and 3600.' }, { status: 400 });
    }

    let publicKey: { pem: string; keyId: string };
    try {
      publicKey = normalizePublicKey(body.verificationPublicKey);
    } catch {
      return NextResponse.json({ error: 'A valid Ed25519 public verification key is required.' }, { status: 400 });
    }

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }
      try {
        const inserted = await client.query(
          `INSERT INTO platform.lead_capture_sources
             (tenant_id, organization_id, source_key, surface, layer_key,
              require_signed_ticket, status, verification_algorithm,
              verification_public_key, verification_key_id, max_clock_skew_seconds)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, true, 'ACTIVE', 'ED25519', $6, $7, $8)
           RETURNING source_id, source_key, surface, layer_key, status,
                     verification_algorithm, verification_key_id, max_clock_skew_seconds, created_at`,
          [context.tenantId, context.organizationId, sourceKey, surface, layerKey,
           publicKey.pem, publicKey.keyId, maxClockSkewSeconds],
        );
        return NextResponse.json({ success: true, source: inserted.rows[0] }, { status: 201 });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          return NextResponse.json({ error: 'That capture source key already exists in this tenant.' }, { status: 409 });
        }
        throw error;
      }
    });
  } catch (error) {
    console.error('Brand capture source creation failed:', error);
    return NextResponse.json({ error: 'Unable to create capture source.' }, { status: 500 });
  }
}
