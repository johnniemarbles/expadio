import { NextResponse } from 'next/server';
import { promises as dns } from 'node:dns';
import { governedResendApiTokenProvider } from '@expadio/communication/governed-resend-binding';
import { routePreparedCommunicationDispatch } from '@expadio/communication/dispatch-routing';
import type { PreparedCommunicationDispatch } from '@expadio/communication/dispatch';
import {
  PostgresConnectorCredentialRepository,
  PostgresProviderRegistryRepository,
} from '@expadio/postgres-runtime/provider-registry';
import { createGovernedCredentialLeaseRuntime } from '@expadio/postgres-runtime/governed-credential-lease-runtime';
import {
  resolveRequestContext,
  withTenantClient,
  withTenantTransaction,
  deniedResponse,
} from '../../../../../../lib/request-context';
import { expectedDnsRecords } from '../../../../../../lib/dns-records';
import { requireCommunicationDomainAdmin } from '../../../../../../lib/communication-domain-admin';
import { delegatedSecretResolver } from '../../../../../../lib/vault-secret-resolver';

/**
 * Sending-domain verification is deliberately two-stage:
 *   1. live DNS preflight for EXPADIO-controlled SPF/DMARC/return-path records;
 *   2. provider-account evidence from the connector production routing selects.
 *
 * Provider-issued DKIM cannot be inferred from EXPADIO's generic DNS template.
 * For the production Resend email path, VERIFIED therefore requires the routed
 * Resend account to report sending enabled for the exact domain (or legacy
 * `verified` status when capability detail is unavailable). DNS-only success
 * remains PENDING.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_CAPABILITY_KEY = 'communication.email.send';

interface RecordCheck {
  purpose: string;
  type: string;
  name: string;
  ok: boolean;
  detail: string;
}

interface ProviderDomainCheck {
  providerKey: string;
  connectorKey: string | null;
  checked: boolean;
  ok: boolean;
  providerStatus: string | null;
  sendingCapability: string | null;
  detail: string;
}

type DnsSpec = ReturnType<typeof expectedDnsRecords>[number];

function normalizeTxt(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function requiredTokens(value: string) {
  return normalizeTxt(value).split(' ').filter(Boolean);
}

function normalizeHost(value: string) {
  return value.trim().replace(/\.$/, '').toLowerCase();
}

async function checkRecord(spec: DnsSpec): Promise<RecordCheck> {
  const base = { purpose: spec.purpose, type: spec.type, name: spec.name };
  try {
    if (spec.purpose === 'SPF') {
      const txt = (await dns.resolveTxt(spec.name)).map((chunks) => chunks.join(''));
      const candidates = txt.filter((record) => normalizeTxt(record).startsWith('v=spf1'));
      const required = requiredTokens(spec.value);
      const found = candidates.find((record) => {
        const tokens = new Set(requiredTokens(record));
        return required.every((token) => tokens.has(token));
      });
      return {
        ...base,
        ok: found !== undefined,
        detail: found ?? (candidates.length > 0
          ? `SPF exists but does not contain the required policy: ${spec.value}`
          : 'No v=spf1 TXT record found.'),
      };
    }

    if (spec.purpose === 'DMARC') {
      const txt = (await dns.resolveTxt(spec.name)).map((chunks) => chunks.join(''));
      const candidates = txt.filter((record) => normalizeTxt(record).startsWith('v=dmarc1'));
      const requiredDirectives = spec.value
        .split(';')
        .map((directive) => normalizeTxt(directive))
        .filter(Boolean);
      const found = candidates.find((record) => {
        const directives = new Set(record.split(';').map((directive) => normalizeTxt(directive)).filter(Boolean));
        return requiredDirectives.every((directive) => directives.has(directive));
      });
      return {
        ...base,
        ok: found !== undefined,
        detail: found ?? (candidates.length > 0
          ? `DMARC exists but does not contain the required policy: ${spec.value}`
          : 'No v=DMARC1 TXT record found.'),
      };
    }

    if (spec.purpose === 'Return-path (MX)') {
      const mx = await dns.resolveMx(spec.name);
      const requiredExchange = normalizeHost(spec.value);
      const found = mx.find((record) =>
        normalizeHost(record.exchange) === requiredExchange
        && (spec.priority === undefined || record.priority === spec.priority),
      );
      return {
        ...base,
        ok: found !== undefined,
        detail: found
          ? `${found.priority} ${found.exchange}`
          : (mx.length > 0
            ? `MX exists but required ${spec.priority ?? ''} ${spec.value}`.trim()
            : 'No MX records found.'),
      };
    }

    return { ...base, ok: false, detail: 'Unsupported DNS requirement.' };
  } catch (error) {
    return { ...base, ok: false, detail: (error as Error).message };
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ senderId: string }> },
) {
  try {
    const context = await resolveRequestContext(request);
    const senderId = decodeURIComponent((await params).senderId).trim();
    if (!UUID_RE.test(senderId)) {
      return NextResponse.json({ error: 'senderId must be a valid UUID.' }, { status: 400 });
    }

    const senderLookup = await withTenantClient(context, async (client) => {
      if (!(await requireCommunicationDomainAdmin(client, context.subjectId, context.tenantId))) {
        return { kind: 'FORBIDDEN' as const };
      }
      const sender = await client.query(
        `SELECT sender_id, address, verification_status, scope, organization_id
           FROM platform.communication_sender_identities
          WHERE sender_id = $1::uuid
            AND tenant_id = $2::uuid
            AND scope IN ('TENANT', 'ORGANIZATION')
            AND channel = 'email'
          LIMIT 1`,
        [senderId, context.tenantId],
      );
      const row = sender.rows[0];
      return row === undefined ? { kind: 'NOT_FOUND' as const } : { kind: 'FOUND' as const, row };
    });

    if (senderLookup.kind === 'FORBIDDEN') {
      return NextResponse.json(
        { denied: true, reasonKey: 'FORBIDDEN', message: 'Sending-domain administration is required.' },
        { status: 403 },
      );
    }
    if (senderLookup.kind === 'NOT_FOUND') {
      return NextResponse.json({ error: 'That tenant or organization sending domain was not found.' }, { status: 404 });
    }

    const address = String(senderLookup.row.address);
    const domain = (address.includes('@') ? address.split('@')[1] : address).trim().toLowerCase();
    const verifiable = expectedDnsRecords(domain).filter((spec) => spec.verifiable);
    const checks = await Promise.all(verifiable.map(checkRecord));
    const dnsVerified = checks.length > 0 && checks.every((check) => check.ok);
    const requestedAt = new Date().toISOString();

    let provider: ProviderDomainCheck = {
      providerKey: 'resend',
      connectorKey: null,
      checked: false,
      ok: false,
      providerStatus: null,
      sendingCapability: null,
      detail: 'Provider verification is skipped until all DNS preflight checks pass.',
    };

    if (dnsVerified) {
      provider = await withTenantTransaction(context, async (client) => {
        if (!(await requireCommunicationDomainAdmin(client, context.subjectId, context.tenantId))) {
          return {
            providerKey: 'resend',
            connectorKey: null,
            checked: false,
            ok: false,
            providerStatus: null,
            sendingCapability: null,
            detail: 'Sending-domain administration is no longer authorized.',
          };
        }

        const registry = new PostgresProviderRegistryRepository(client);
        const connectors = await registry.listConnectors(context.tenantId, EMAIL_CAPABILITY_KEY);
        const policy = await registry.loadRoutingPolicy(context.tenantId, EMAIL_CAPABILITY_KEY);
        const routingProbe: PreparedCommunicationDispatch = {
          tenantId: context.tenantId,
          ...(senderLookup.row.organization_id
            ? { organizationId: String(senderLookup.row.organization_id) }
            : {}),
          triggerKey: 'communications.domain.verify',
          purpose: 'system',
          channel: 'email',
          recipient: { email: address },
          recipientKey: address,
          idempotencyKey: `domain-verify:${senderId}`,
          templateScope: 'PLATFORM',
          rendered: {
            templateId: 'platform-domain-verification-routing-probe',
            version: 1,
            channel: 'email',
            locale: 'en',
            format: 'TEXT',
            subject: 'Domain verification routing probe',
            body: 'No message is sent by this routing probe.',
            variables: {},
          },
          compliance: {
            preflight: {
              allowed: true,
              reasonCode: 'OK',
              reason: 'Domain verification routing probe passed preflight.',
            },
            evaluatedAt: requestedAt,
          },
          routing: { capabilityKey: EMAIL_CAPABILITY_KEY },
          requestedAt,
        };
        const routed = routePreparedCommunicationDispatch(
          routingProbe,
          connectors,
          policy ?? undefined,
        );
        if (!routed.routed) {
          return {
            providerKey: 'routing',
            connectorKey: null,
            checked: true,
            ok: false,
            providerStatus: null,
            sendingCapability: null,
            detail: `Production email routing cannot select an eligible connector (${routed.reasonCode}).`,
          };
        }

        const connector = connectors.find(
          (candidate) => candidate.connectorKey === routed.connector.connectorKey,
        );
        if (connector === undefined) {
          return {
            providerKey: routed.connector.providerKey,
            connectorKey: routed.connector.connectorKey,
            checked: true,
            ok: false,
            providerStatus: null,
            sendingCapability: null,
            detail: 'Production routing selected a connector that is unavailable to the verification boundary.',
          };
        }
        if (connector.providerKey.trim().toLowerCase() !== 'resend') {
          return {
            providerKey: connector.providerKey,
            connectorKey: connector.connectorKey,
            checked: true,
            ok: false,
            providerStatus: null,
            sendingCapability: null,
            detail: `Production routing selected ${connector.providerKey}; provider-side domain evidence is not implemented for that email provider yet.`,
          };
        }

        try {
          const credentialRepository = new PostgresConnectorCredentialRepository(client);
          const leaseService = createGovernedCredentialLeaseRuntime({
            client,
            contextProvider: {
              async resolve() {
                return {
                  subjectId: context.subjectId,
                  actorKind: 'user' as const,
                  tenantId: context.tenantId,
                  organizationId: context.organizationId ?? '',
                };
              },
            },
          });
          const tokenProvider = governedResendApiTokenProvider({
            connector,
            credentialRepository,
            leaseService,
            secretResolver: delegatedSecretResolver,
            requestedBySubjectId: context.subjectId,
            requestId: () => crypto.randomUUID(),
            correlationId: () => crypto.randomUUID(),
          });
          const token = await tokenProvider({
            tenantId: context.tenantId,
            ...(senderLookup.row.organization_id
              ? { organizationId: String(senderLookup.row.organization_id) }
              : {}),
            triggerKey: 'communications.domain.verify',
            idempotencyKey: `domain-verify:${senderId}`,
            purpose: 'system',
            requestedAt,
          });

          const response = await fetch('https://api.resend.com/domains', {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
          });
          const body = await response.json().catch(() => null) as {
            data?: Array<{
              name?: unknown;
              status?: unknown;
              capabilities?: { sending?: unknown };
            }>;
          } | null;
          if (!response.ok) {
            return {
              providerKey: 'resend',
              connectorKey: connector.connectorKey,
              checked: true,
              ok: false,
              providerStatus: null,
              sendingCapability: null,
              detail: `Resend domain verification query returned HTTP ${response.status}.`,
            };
          }

          const match = (body?.data ?? []).find((candidate) =>
            typeof candidate.name === 'string' && candidate.name.trim().toLowerCase() === domain,
          );
          if (match === undefined) {
            return {
              providerKey: 'resend',
              connectorKey: connector.connectorKey,
              checked: true,
              ok: false,
              providerStatus: null,
              sendingCapability: null,
              detail: 'The domain is not registered in the Resend account selected by production routing.',
            };
          }

          const providerStatus = typeof match.status === 'string' ? match.status.trim().toLowerCase() : null;
          const sendingCapability = typeof match.capabilities?.sending === 'string'
            ? match.capabilities.sending.trim().toLowerCase()
            : null;
          const providerReady = sendingCapability === null
            ? providerStatus === 'verified'
            : sendingCapability === 'enabled';

          return {
            providerKey: 'resend',
            connectorKey: connector.connectorKey,
            checked: true,
            ok: providerReady,
            providerStatus,
            sendingCapability,
            detail: providerReady
              ? 'The production-routed Resend account confirms this domain is enabled for sending.'
              : `The production-routed Resend account has the domain, but sending is not enabled${providerStatus ? ` (status: ${providerStatus})` : ''}.`,
          };
        } catch {
          return {
            providerKey: 'resend',
            connectorKey: connector.connectorKey,
            checked: true,
            ok: false,
            providerStatus: null,
            sendingCapability: null,
            detail: 'The production-routed Resend credential or domain lookup is unavailable.',
          };
        }
      });
    }

    const nextStatus = dnsVerified && provider.ok ? 'VERIFIED' : 'PENDING';
    await withTenantClient(context, async (client) => {
      if (!(await requireCommunicationDomainAdmin(client, context.subjectId, context.tenantId))) {
        throw new Error('COMMUNICATION_DOMAIN_ADMIN_AUTHORIZATION_CHANGED');
      }
      await client.query(
        `UPDATE platform.communication_sender_identities
            SET verification_status = $2, updated_at = now()
          WHERE sender_id = $1::uuid
            AND tenant_id = $3::uuid
            AND scope IN ('TENANT', 'ORGANIZATION')`,
        [senderId, nextStatus, context.tenantId],
      );
    });

    return NextResponse.json({
      success: true,
      domain,
      dnsVerified,
      providerVerified: provider.ok,
      verificationStatus: nextStatus,
      checks,
      provider,
    });
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
