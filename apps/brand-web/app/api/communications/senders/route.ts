import { NextResponse } from 'next/server';
import { hasBrandGovernanceForOrganization, resolveBrandContext, withBrandTransaction } from '../../../../lib/brand-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ADDRESS_RE = /^[^\s@]+@([^\s@]+)$/;
const PURPOSES = ['transactional', 'marketing'] as const;
type Purpose = (typeof PURPOSES)[number];

export async function GET() {
  try {
    const context = await resolveBrandContext();
    return await withBrandTransaction(context, async (client) => {
      const result = await client.query(
        `SELECT sender_id, address, display_name, reply_to, purposes, is_default,
                verification_status, status, created_at, updated_at
           FROM platform.communication_sender_identities
          WHERE tenant_id = $1::uuid
            AND organization_id = $2::uuid
            AND scope = 'ORGANIZATION'
            AND channel = 'email'
          ORDER BY is_default DESC, created_at DESC`,
        [context.tenantId, context.organizationId],
      );
      return NextResponse.json(result.rows.map((row) => ({
        senderId: row.sender_id,
        address: row.address,
        domain: String(row.address).split('@')[1] ?? row.address,
        displayName: row.display_name,
        replyTo: row.reply_to,
        purposes: row.purposes,
        isDefault: row.is_default,
        verificationStatus: row.verification_status,
        status: row.status,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      })));
    });
  } catch (error) {
    console.error('Brand sender read failed:', error);
    return NextResponse.json({ error: 'Unable to load organization senders.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const context = await resolveBrandContext();
    const body = await request.json();
    const domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';
    const displayName = typeof body.displayName === 'string' && body.displayName.trim()
      ? body.displayName.trim().slice(0, 120)
      : 'Brand Sender';
    const rawAddress = typeof body.address === 'string' && body.address.trim()
      ? body.address.trim().toLowerCase()
      : `notifications@${domain}`;
    const replyTo = typeof body.replyTo === 'string' && body.replyTo.trim() ? body.replyTo.trim().toLowerCase() : null;
    const requestedPurposes = Array.isArray(body.purposes)
      ? body.purposes.filter((value: unknown): value is Purpose => typeof value === 'string' && PURPOSES.includes(value as Purpose))
      : ['transactional'] satisfies Purpose[];
    const purposes = [...new Set<Purpose>(requestedPurposes)];

    if (!DOMAIN_RE.test(domain)) return NextResponse.json({ error: 'A valid sending domain is required.' }, { status: 400 });
    const addressMatch = ADDRESS_RE.exec(rawAddress);
    if (!addressMatch || addressMatch[1]?.toLowerCase() !== domain) {
      return NextResponse.json({ error: 'Sender address must belong to the submitted domain.' }, { status: 400 });
    }
    if (replyTo && !ADDRESS_RE.test(replyTo)) return NextResponse.json({ error: 'replyTo must be a valid email address.' }, { status: 400 });
    if (purposes.length === 0) return NextResponse.json({ error: 'At least one supported sender purpose is required.' }, { status: 400 });

    return await withBrandTransaction(context, async (client) => {
      if (!await hasBrandGovernanceForOrganization(client, context.subjectId, context.organizationId)) {
        return NextResponse.json({ denied: true, reasonKey: 'FORBIDDEN', message: 'Brand communication administration is required.' }, { status: 403 });
      }
      const result = await client.query(
        `INSERT INTO platform.communication_sender_identities
          (scope, tenant_id, organization_id, channel, address, display_name, reply_to,
           purposes, is_default, is_system_fallback, verification_status, status)
         VALUES ('ORGANIZATION', $1::uuid, $2::uuid, 'email', $3, $4, $5, $6::text[], false, false, 'PENDING', 'ACTIVE')
         ON CONFLICT (tenant_id, organization_id, channel, lower(address)) WHERE scope = 'ORGANIZATION'
         DO UPDATE SET
           display_name = EXCLUDED.display_name,
           reply_to = EXCLUDED.reply_to,
           purposes = EXCLUDED.purposes,
           status = 'ACTIVE',
           verification_status = platform.communication_sender_identities.verification_status,
           updated_at = now()
         RETURNING sender_id, address, display_name, reply_to, purposes, is_default,
                   verification_status, status, created_at, updated_at`,
        [context.tenantId, context.organizationId, rawAddress, displayName, replyTo, purposes],
      );
      return NextResponse.json({ success: true, sender: result.rows[0] }, { status: 201 });
    });
  } catch (error: any) {
    if (error?.code === '23505') return NextResponse.json({ error: 'That sender identity conflicts with an existing organization sender.' }, { status: 409 });
    console.error('Brand sender creation failed:', error);
    return NextResponse.json({ error: 'Unable to create organization sender.' }, { status: 500 });
  }
}
