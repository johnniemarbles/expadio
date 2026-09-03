import { createHash, createPublicKey } from 'node:crypto';
import { NextResponse } from 'next/server';
import { generatePublishableKey, normalizeOrigins } from '@expadio/lead-capture';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SURFACES = new Set(['FORM', 'WEBHOOK', 'API']);
const CHANNELS = new Set(['WEB', 'EMAIL', 'SMS', 'WHATSAPP', 'SOCIAL', 'IMPORT', 'MANUAL', 'API']);
const TRUST_RAILS = new Set(['SIGNED', 'PUBLIC']);

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
        `SELECT source_id, source_key, surface, channel, trust_rail, layer_key, status,
                publishable_key, allowed_origins,
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
        channel: row.channel,
        trustRail: row.trust_rail,
        layerKey: row.layer_key,
        status: row.status,
        // publishable_key is a public identifier and is safe to return; the
        // signed rail's verification key id is likewise non-secret.
        publishableKey: row.publishable_key,
        allowedOrigins: row.allowed_origins ?? [],
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
    const trustRail = typeof body.trustRail === 'string' ? body.trustRail.trim().toUpperCase() : 'SIGNED';
    const channel = typeof body.channel === 'string' ? body.channel.trim().toUpperCase() : 'WEB';
    const layerKey = typeof body.layerKey === 'string' && body.layerKey.trim() ? body.layerKey.trim() : null;
    const maxClockSkewSeconds = body.maxClockSkewSeconds === undefined ? 300 : Number(body.maxClockSkewSeconds);

    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/u.test(sourceKey)) {
      return NextResponse.json({ error: 'sourceKey must be 3-80 safe characters.' }, { status: 400 });
    }
    if (!SURFACES.has(surface)) return NextResponse.json({ error: 'Unsupported capture surface.' }, { status: 400 });
    if (!TRUST_RAILS.has(trustRail)) return NextResponse.json({ error: 'Unsupported trust rail.' }, { status: 400 });
    if (!CHANNELS.has(channel)) return NextResponse.json({ error: 'Unsupported channel.' }, { status: 400 });
    if (!Number.isInteger(maxClockSkewSeconds) || maxClockSkewSeconds < 30 || maxClockSkewSeconds > 3600) {
      return NextResponse.json({ error: 'maxClockSkewSeconds must be between 30 and 3600.' }, { status: 400 });
    }

    // Rail-specific inputs. SIGNED needs an Ed25519 public key (the caller signs);
    // PUBLIC needs an origin allowlist and gets a generated publishable key.
    let signedKey: { pem: string; keyId: string } | null = null;
    let publishableKey: string | null = null;
    let allowedOrigins: string[] = [];
    if (trustRail === 'SIGNED') {
      try {
        signedKey = normalizePublicKey(body.verificationPublicKey);
      } catch {
        return NextResponse.json({ error: 'A valid Ed25519 public verification key is required.' }, { status: 400 });
      }
    } else {
      const rawOrigins = Array.isArray(body.allowedOrigins) ? body.allowedOrigins : [];
      try {
        allowedOrigins = normalizeOrigins(rawOrigins);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'ORIGIN_INVALID';
        const message = code === 'TOO_MANY_ORIGINS'
          ? 'A capture source allows at most 20 origins.'
          : 'At least one valid https origin (scheme://host) is required.';
        return NextResponse.json({ error: message }, { status: 400 });
      }
      publishableKey = generatePublishableKey();
    }

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId!)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand governance is required.' }, { status: 403 });
      }
      try {
        const inserted = await client.query(
          `INSERT INTO platform.lead_capture_sources
             (tenant_id, organization_id, source_key, surface, channel, trust_rail, layer_key,
              require_signed_ticket, status, verification_algorithm,
              verification_public_key, verification_key_id, max_clock_skew_seconds,
              publishable_key, allowed_origins)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7,
                   $8, 'ACTIVE', 'ED25519', $9, $10, $11, $12, $13::text[])
           RETURNING source_id, source_key, surface, channel, trust_rail, layer_key, status,
                     publishable_key, allowed_origins, verification_key_id,
                     max_clock_skew_seconds, created_at`,
          [
            context.tenantId, context.organizationId, sourceKey, surface, channel, trustRail, layerKey,
            trustRail === 'SIGNED', signedKey?.pem ?? null, signedKey?.keyId ?? null, maxClockSkewSeconds,
            publishableKey, allowedOrigins,
          ],
        );
        const row = inserted.rows[0];
        return NextResponse.json({
          success: true,
          source: {
            sourceId: row.source_id,
            sourceKey: row.source_key,
            surface: row.surface,
            channel: row.channel,
            trustRail: row.trust_rail,
            layerKey: row.layer_key,
            status: row.status,
            // The publishable key is returned so the operator can wire it into the
            // embed/SDK. It is a public identifier, not a secret.
            publishableKey: row.publishable_key,
            allowedOrigins: row.allowed_origins ?? [],
            verificationKeyId: row.verification_key_id,
            maxClockSkewSeconds: row.max_clock_skew_seconds,
            createdAt: new Date(row.created_at).toISOString(),
          },
        }, { status: 201 });
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
