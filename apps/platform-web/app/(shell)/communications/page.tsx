import { DeniedState, EmptyState } from "@expadio/ui";
import { isDenied } from "@expadio/ui/contracts";
import type {
  CommunicationChannel,
  CommunicationOverview,
} from "../../../lib/communication-contracts";
import type { ConnectorListItem } from "../../api/communications/providers/route";
import { fetchApi } from "../../../lib/live-adapter";
import Link from "next/link";
import styles from "./page.module.css";

const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  voice: "Voice",
  in_app: "In-app",
  push: "Push",
  rcs: "RCS",
};

const FAILURE_STATES = new Set(["FAILED", "BOUNCED", "COMPLAINED", "CANCELLED"]);

function number(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default async function CommunicationsPage() {
  const [overview, providers] = await Promise.all([
    fetchApi<CommunicationOverview>("/api/communications/overview"),
    fetchApi<ConnectorListItem[]>("/api/communications/providers"),
  ]);
  if (isDenied(overview)) return <DeniedState result={overview} />;

  const readyToSend =
    overview.readiness.activeTemplates > 0 && overview.readiness.verifiedSenders > 0;

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Customer engagement</p>
          <h1 id="page-title">Communications</h1>
          <p>Email, SMS, messaging, notifications, and voice delivery in one governed workspace.</p>
        </div>
        <div className={styles.liveBadge} aria-label="Live database connection">
          <span aria-hidden="true" /> Live database
        </div>
      </section>

      <section className={styles.readinessBanner} aria-labelledby="readiness-title">
        <div>
          <p className={styles.eyebrow}>Sending readiness</p>
          <h2 id="readiness-title">
            {readyToSend ? "Templates and verified senders are ready" : "Provider activation required"}
          </h2>
          <p>
            {readyToSend
              ? "The governed preflight foundation is ready for concrete provider adapters."
              : "Connect a provider, verify a sender identity, and activate at least one template before enabling sends."}
          </p>
        </div>
        <span className={readyToSend ? styles.statusReady : styles.statusPending}>
          {readyToSend ? "Foundation ready" : "Sending disabled"}
        </span>
      </section>

      <section className={styles.metricGrid} aria-label="Communication metrics">
        <article className={styles.metricCard}>
          <span>All deliveries</span><strong>{number(overview.totals.deliveries)}</strong>
          <small>{number(overview.totals.inFlight)} currently in flight</small>
        </article>
        <article className={styles.metricCard}>
          <span>Delivered</span><strong>{number(overview.totals.delivered)}</strong>
          <small>Provider-confirmed delivery evidence</small>
        </article>
        <article className={styles.metricCard}>
          <span>Failed or suppressed</span><strong>{number(overview.totals.failed)}</strong>
          <small>{number(overview.readiness.activeSuppressions)} active suppressions</small>
        </article>
        <article className={styles.metricCard}>
          <span>Ready assets</span><strong>{number(overview.readiness.activeTemplates)}</strong>
          <small>{number(overview.readiness.verifiedSenders)} verified sender identities</small>
        </article>
      </section>

      <section className={styles.panel} aria-labelledby="channels-title">
        <div className={styles.panelHeading}>
          <div><p className={styles.eyebrow}>Delivery fabric</p><h2 id="channels-title">Channels</h2></div>
          <span className={styles.muted}>Captured {dateTime(overview.capturedAt)} UTC</span>
        </div>
        <div className={styles.channelGrid}>
          {overview.channels.map((channel) => (
            <article className={styles.channelCard} key={channel.channel}>
              <div className={styles.channelTitle}>
                <h3>{CHANNEL_LABELS[channel.channel]}</h3>
                <span>{channel.total > 0 ? "Active" : "No traffic"}</span>
              </div>
              <strong>{channel.deliveryRate === null ? "—" : `${channel.deliveryRate}%`}</strong>
              <p>{number(channel.delivered)} delivered · {number(channel.failed)} failed</p>
            </article>
          ))}
        </div>
      </section>

      <div className={styles.twoColumn}>
        <section className={styles.panel} aria-labelledby="assets-title">
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Configuration</p><h2 id="assets-title">Readiness assets</h2></div></div>
          <dl className={styles.readinessList}>
            <div><dt>Active templates</dt><dd>{number(overview.readiness.activeTemplates)}</dd></div>
            <div><dt>Draft templates</dt><dd>{number(overview.readiness.draftTemplates)}</dd></div>
            <div><dt>Verified senders</dt><dd>{number(overview.readiness.verifiedSenders)}</dd></div>
            <div><dt>Pending senders</dt><dd>{number(overview.readiness.pendingSenders)}</dd></div>
            <div><dt>Active suppressions</dt><dd>{number(overview.readiness.activeSuppressions)}</dd></div>
          </dl>
        </section>

        <section className={styles.panel} aria-labelledby="safety-title">
          <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Policy boundary</p><h2 id="safety-title">Always enforced</h2></div></div>
          <ul className={styles.safetyList}>
            <li>Consent and suppression preflight</li>
            <li>Tenant and organization isolation</li>
            <li>Verified sender resolution</li>
            <li>Idempotent provider attempts</li>
            <li>Signed webhook delivery evidence</li>
          </ul>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="registry-title">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Infrastructure</p>
            <h2 id="registry-title">Provider Registry</h2>
          </div>
          <Link href="/capabilities" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--brand)', textDecoration: 'none' }}>
            Capabilities →
          </Link>
        </div>
        {!isDenied(providers) && providers.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Channel</th>
                  <th>Connector Key</th>
                  <th>Scope</th>
                  <th>Credential</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((c) => (
                  <tr key={c.connectorKey}>
                    <td>
                      <strong style={{ textTransform: 'capitalize' }}>{c.providerKey}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--ink-500)', marginTop: 2 }}>{c.providerType}</div>
                    </td>
                    <td>
                      {c.capabilityKeys.map((k) => (
                        <span key={k} style={{ display: 'inline-block', marginRight: 4, padding: '2px 7px', borderRadius: 4, background: 'var(--canvas)', color: 'var(--ink-600)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                          {k.replace('-delivery', '').replace('-', ' ')}
                        </span>
                      ))}
                    </td>
                    <td><code>{c.connectorKey}</code></td>
                    <td style={{ fontSize: 12, color: 'var(--ink-500)' }}>{c.ownershipScope}</td>
                    <td>
                      <span style={{
                        display: 'inline-flex', padding: '3px 8px', borderRadius: 6,
                        fontSize: 11, fontWeight: 800,
                        color: c.hasCredential ? '#0d6b46' : '#925b0b',
                        background: c.hasCredential ? '#e8f7f0' : '#fff4dc'
                      }}>
                        {c.hasCredential ? 'Configured' : 'Not configured'}
                      </span>
                    </td>
                    <td>
                      <span className={c.enabled && c.health === 'HEALTHY' ? styles.stateDefault : c.health === 'UNHEALTHY' ? styles.stateFailed : styles.stateDefault}
                        style={c.enabled && c.health !== 'HEALTHY' ? { color: '#925b0b', background: '#fff4dc' } : undefined}>
                        {c.enabled ? c.health : 'Disabled'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No providers registered"
            description="Register Twilio, Resend or other connectors via the Capabilities section to enable governed communication dispatch."
          />
        )}
      </section>

      <section className={styles.panel} aria-labelledby="delivery-title">
        <div className={styles.panelHeading}>
          <div><p className={styles.eyebrow}>Operations</p><h2 id="delivery-title">Recent delivery evidence</h2></div>
        </div>
        {overview.recentDeliveries.length === 0 ? (
          <EmptyState title="No delivery evidence yet" description="Deliveries will appear after a provider adapter accepts the first governed communication intent." />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Channel</th><th>State</th><th>Connector</th><th>Attempts</th><th>Last update</th></tr></thead>
              <tbody>
                {overview.recentDeliveries.map((delivery) => (
                  <tr key={delivery.id}>
                    <td><strong>{CHANNEL_LABELS[delivery.channel]}</strong></td>
                    <td><span className={FAILURE_STATES.has(delivery.state) ? styles.stateFailed : styles.stateDefault}>{delivery.state}</span></td>
                    <td><code>{delivery.connectorKey}</code></td>
                    <td>{delivery.attemptCount}</td>
                    <td>{dateTime(delivery.updatedAt)} UTC</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
