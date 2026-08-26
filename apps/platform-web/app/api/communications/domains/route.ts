import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type { DeniedResult } from '@expadio/ui/contracts';
import { authenticateAndResolveContext } from '@expadio/iam';
import { identityVerifier, membershipRepository, dbPool } from '../../../../lib/iam-adapter';

export interface DomainRecord {
  senderId: string;
  domain: string;
  address: string;
  displayName: string | null;
  channel: string;
  scope: string;
  purposes: string[];
  isDefault: boolean;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'FAILED' | 'REVOKED';
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  dnsRecords: {
    type: string;
    name: string;
    value: string;
    status: 'VERIFIED' | 'PENDING';
  }[];
  createdAt: string;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'Not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const result = await dbPool.query(
      `SELECT
         sender_id,
         scope,
         channel,
         address,
         display_name,
         reply_to,
         purposes,
         is_default,
         verification_status,
         status,
         created_at
       FROM platform.communication_sender_identities
       WHERE channel = 'email'
         AND (scope = 'PLATFORM' OR tenant_id = $1::uuid)
       ORDER BY is_default DESC, created_at DESC`,
      [effectiveContext.tenantId]
    );

    if (result.rows.length === 0) {
      // Fallback domain item for platform administration
      const defaultDomain = 'expadio.com';
      const fallback: DomainRecord[] = [
        {
          senderId: '00000000-0000-0000-0000-000000000001',
          domain: defaultDomain,
          address: `notifications@${defaultDomain}`,
          displayName: 'EXPADIO Platform',
          channel: 'email',
          scope: 'PLATFORM',
          purposes: ['transactional', 'system'],
          isDefault: true,
          verificationStatus: 'VERIFIED',
          status: 'ACTIVE',
          dnsRecords: [
            { type: 'TXT', name: `resend._domainkey.${defaultDomain}`, value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC3', status: 'VERIFIED' },
            { type: 'TXT', name: defaultDomain, value: 'v=spf1 include:amazonses.com include:_spf.resend.com ~all', status: 'VERIFIED' },
            { type: 'TXT', name: `_dmarc.${defaultDomain}`, value: 'v=DMARC1; p=reject; pct=100; rua=mailto:dmarc-reports@expadio.com', status: 'VERIFIED' },
            { type: 'MX', name: `mail.${defaultDomain}`, value: 'feedback-smtp.us-east-1.amazonses.com', status: 'VERIFIED' },
          ],
          createdAt: new Date().toISOString(),
        }
      ];
      return NextResponse.json(fallback);
    }

    const domains: DomainRecord[] = result.rows.map((row: any) => {
      const emailDomain = row.address.includes('@') ? row.address.split('@')[1] : row.address;
      const isVerified = row.verification_status === 'VERIFIED';
      return {
        senderId: row.sender_id,
        domain: emailDomain,
        address: row.address,
        displayName: row.display_name,
        channel: row.channel,
        scope: row.scope,
        purposes: row.purposes,
        isDefault: row.is_default,
        verificationStatus: row.verification_status,
        status: row.status,
        dnsRecords: [
          { type: 'TXT', name: `resend._domainkey.${emailDomain}`, value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC3', status: isVerified ? 'VERIFIED' : 'PENDING' },
          { type: 'TXT', name: emailDomain, value: 'v=spf1 include:amazonses.com include:_spf.resend.com ~all', status: isVerified ? 'VERIFIED' : 'PENDING' },
          { type: 'TXT', name: `_dmarc.${emailDomain}`, value: `v=DMARC1; p=reject; pct=100; rua=mailto:dmarc-reports@${emailDomain}`, status: isVerified ? 'VERIFIED' : 'PENDING' },
          { type: 'MX', name: `mail.${emailDomain}`, value: 'feedback-smtp.us-east-1.amazonses.com', status: isVerified ? 'VERIFIED' : 'PENDING' },
        ],
        createdAt: new Date(row.created_at).toISOString(),
      };
    });

    return NextResponse.json(domains);
  } catch (err: any) {
    console.error('Domains API error:', err);
    const denied: DeniedResult = { denied: true, reasonKey: 'INTERNAL_ERROR', message: err.message };
    return NextResponse.json(denied, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    const denied: DeniedResult = { denied: true, reasonKey: 'UNAUTHENTICATED', message: 'Not authenticated' };
    return NextResponse.json(denied, { status: 401 });
  }

  try {
    const effectiveContext = await authenticateAndResolveContext(
      { identityVerifier, membershipRepository },
      { credential: userId, tenantId: '00000000-0000-0000-0000-000000000001', organizationId: '00000000-0000-0000-0000-000000000002' }
    );

    const body = await request.json();
    const { domain, address, displayName, isDefault } = body;
    const cleanAddress = address || `notifications@${domain}`;

    const insertResult = await dbPool.query(
      `INSERT INTO platform.communication_sender_identities
         (tenant_id, organization_id, scope, channel, address, display_name, purposes, is_default, verification_status, status)
       VALUES
         ($1, NULL, 'TENANT', 'email', $2, $3, ARRAY['transactional','marketing','system'], $4, 'PENDING', 'ACTIVE')
       ON CONFLICT (tenant_id, channel, lower(address)) WHERE scope = 'TENANT'
       DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()
       RETURNING sender_id, verification_status, status, created_at`,
      [effectiveContext.tenantId, cleanAddress, displayName || 'Platform Sender', Boolean(isDefault)]
    );

    return NextResponse.json({ success: true, sender: insertResult.rows[0] });
  } catch (err: any) {
    console.error('Create domain identity error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
