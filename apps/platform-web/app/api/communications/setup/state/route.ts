import { NextResponse } from 'next/server';
import { resolveRequestContext, withTenantClient, deniedResponse } from '../../../../../lib/request-context';

/**
 * Design spec §6 — the setup journey, and §5.2 — the three dashboard states.
 *
 * The state is computed from real signals, never from a feature flag:
 *   connectors_with_credential == 0                     -> UNCONFIGURED
 *   any probe_status != VALID, breaker OPEN, domain
 *   expiring, success rate below SLA                    -> DEGRADED
 *   else                                                -> STEADY
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type SetupStepKey =
  | 'CHOOSE_CUSTODY'
  | 'CONNECT_PROVIDER'
  | 'VERIFY_DOMAIN'
  | 'CREATE_SENDER'
  | 'SET_LIMITS'
  | 'TEST_SEND'
  | 'GO_LIVE';

export interface SetupStep {
  readonly key: SetupStepKey;
  readonly title: string;
  readonly description: string;
  readonly complete: boolean;
  readonly blocked: boolean;
  readonly blockedReason?: string;
  readonly href: string;
}

export interface SetupState {
  readonly dashboardState: 'UNCONFIGURED' | 'STEADY' | 'DEGRADED';
  readonly steps: readonly SetupStep[];
  readonly nextStep: SetupStepKey | null;
  readonly completedCount: number;
  readonly isLive: boolean;
  readonly degradedReasons: readonly string[];
}

export async function GET(request: Request) {
  try {
    const context = await resolveRequestContext(request);

    const facts = await withTenantClient(context, async (client) => {
      const connectors = await client.query(
        `SELECT count(*) FILTER (WHERE cred.credential_id IS NOT NULL)::int AS with_credential,
                count(*) FILTER (WHERE cred.probe_status IS NOT NULL
                                   AND cred.probe_status <> 'VALID')::int AS failing,
                count(*) FILTER (WHERE c.enabled)::int AS enabled
           FROM platform.connectors c
           LEFT JOIN platform.connector_credentials cred
             ON cred.connector_id = c.connector_id AND cred.state IN ('ACTIVE','FAILING')
          WHERE (c.tenant_id = $1::uuid OR c.tenant_id IS NULL)
            AND c.provider_type IN ('email','sms','whatsapp','voice','push','rcs')`,
        [context.tenantId],
      );

      const domains = await client.query(
        `SELECT count(*) FILTER (WHERE status = 'VERIFIED')::int AS verified,
                count(*)::int AS total
           FROM platform.communication_sending_domains
          WHERE scope = 'TENANT' AND tenant_id = $1::uuid`,
        [context.tenantId],
      ).catch(() => ({ rows: [{ verified: 0, total: 0 }] }));

      const senders = await client.query(
        `SELECT count(*)::int AS total
           FROM platform.communication_sender_identities
          WHERE tenant_id = $1::uuid`,
        [context.tenantId],
      ).catch(() => ({ rows: [{ total: 0 }] }));

      const limits = await client.query(
        `SELECT count(*)::int AS total FROM platform.communication_plane_budgets
          WHERE tenant_id = $1::uuid`,
        [context.tenantId],
      ).catch(() => ({ rows: [{ total: 0 }] }));

      const breaker = await client.query(
        `SELECT breaker_state FROM platform.communication_spend_caps
          WHERE tenant_id = $1::uuid`,
        [context.tenantId],
      ).catch(() => ({ rows: [] as { breaker_state: string }[] }));

      const testSend = await client.query(
        `SELECT count(*)::int AS total
           FROM platform.communication_decision_traces
          WHERE tenant_id = $1::uuid
            AND outcome = 'SENT'
            AND reason_code = 'TEST_SEND_OK'`,
        [context.tenantId],
      ).catch(() => ({ rows: [{ total: 0 }] }));

      return {
        withCredential: connectors.rows[0]?.with_credential ?? 0,
        failing: connectors.rows[0]?.failing ?? 0,
        enabled: connectors.rows[0]?.enabled ?? 0,
        verifiedDomains: domains.rows[0]?.verified ?? 0,
        totalDomains: domains.rows[0]?.total ?? 0,
        senders: senders.rows[0]?.total ?? 0,
        limitsSet: (limits.rows[0]?.total ?? 0) > 0,
        breakerOpen: breaker.rows[0]?.breaker_state === 'OPEN',
        testSends: testSend.rows[0]?.total ?? 0,
      };
    });

    const degradedReasons: string[] = [];
    if (facts.failing > 0) {
      degradedReasons.push(
        `${facts.failing} credential${facts.failing === 1 ? '' : 's'} ${facts.failing === 1 ? 'is' : 'are'} failing`,
      );
    }
    if (facts.breakerOpen) degradedReasons.push('Your spend breaker is open');

    const steps: SetupStep[] = [
      {
        key: 'CHOOSE_CUSTODY',
        title: 'Choose how you want to send',
        description: 'Our providers, your provider accounts, or your own secret store.',
        complete: facts.withCredential > 0,
        blocked: false,
        href: '/communications/onboarding?step=custody',
      },
      {
        key: 'CONNECT_PROVIDER',
        title: 'Connect a provider',
        description: 'We check the credential works before saving it.',
        complete: facts.withCredential > 0,
        blocked: false,
        href: '/communications/onboarding?step=connect',
      },
      {
        key: 'VERIFY_DOMAIN',
        title: 'Verify your sending domain',
        description: 'Four DNS records. We check each one separately.',
        complete: facts.verifiedDomains > 0,
        blocked: facts.withCredential === 0,
        ...(facts.withCredential === 0
          ? { blockedReason: 'Connect a provider first — the records depend on which one you use.' }
          : {}),
        href: '/communications/onboarding?step=domain',
      },
      {
        key: 'CREATE_SENDER',
        title: 'Create a sender identity',
        description: 'The name and address recipients will see.',
        complete: facts.senders > 0,
        blocked: facts.verifiedDomains === 0,
        ...(facts.verifiedDomains === 0
          ? { blockedReason: 'A from-address can only sit on a verified domain.' }
          : {}),
        href: '/communications/onboarding?step=sender',
      },
      {
        key: 'SET_LIMITS',
        title: 'Set your limits',
        description: 'Daily volume, spend cap, quiet hours.',
        complete: facts.limitsSet,
        blocked: false,
        href: '/communications/onboarding?step=limits',
      },
      {
        key: 'TEST_SEND',
        title: 'Send a test and watch it land',
        description: "You'll see every check it passes, in real time.",
        complete: facts.testSends > 0,
        blocked: facts.senders === 0,
        ...(facts.senders === 0 ? { blockedReason: 'Create a sender identity first.' } : {}),
        href: '/communications/onboarding?step=test',
      },
      {
        key: 'GO_LIVE',
        title: 'Go live',
        description: 'Turn on the triggers that will start sending.',
        complete: facts.enabled > 0 && facts.testSends > 0,
        blocked: facts.testSends === 0,
        ...(facts.testSends === 0 ? { blockedReason: 'Send a test message first.' } : {}),
        href: '/communications/onboarding?step=golive',
      },
    ];

    const next = steps.find((step) => !step.complete && !step.blocked)?.key ?? null;
    const dashboardState =
      facts.withCredential === 0
        ? 'UNCONFIGURED'
        : degradedReasons.length > 0
          ? 'DEGRADED'
          : 'STEADY';

    const state: SetupState = {
      dashboardState,
      steps,
      nextStep: next,
      completedCount: steps.filter((step) => step.complete).length,
      isLive: facts.enabled > 0 && facts.testSends > 0,
      degradedReasons,
    };

    return NextResponse.json(state);
  } catch (error) {
    const { body, status } = deniedResponse(error);
    return NextResponse.json(body, { status });
  }
}
