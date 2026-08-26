import { DeniedState, EmptyState } from "@expadio/ui";
import { isDenied } from "@expadio/ui/contracts";
import type {
  CommunicationChannel,
  CommunicationOverview,
} from "../../../lib/communication-contracts";
import type { ConnectorListItem } from "../../api/communications/providers/route";
import type { TemplateCatalogueItem } from "../../api/communications/templates/route";
import type { FleetHealthItem } from "../../api/communications/fleet/route";
import { fetchApi } from "../../../lib/live-adapter";
import Link from "next/link";
import styles from "./page.module.css";

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  voice: "Voice",
  in_app: "In-app",
  push: "Push",
  rcs: "RCS",
};

function number(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default async function CommunicationsPage() {
  const [overview, providers, templates, fleet] = await Promise.all([
    fetchApi<CommunicationOverview>("/api/communications/overview"),
    fetchApi<ConnectorListItem[]>("/api/communications/providers"),
    fetchApi<TemplateCatalogueItem[]>("/api/communications/templates"),
    fetchApi<FleetHealthItem[]>("/api/communications/fleet"),
  ]);

  if (isDenied(overview)) return <DeniedState result={overview} />;

  const readyToSend =
    overview.readiness.activeTemplates > 0 && overview.readiness.verifiedSenders > 0;

  return (
    <>
      {/* Platform Header */}
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Platform Admin · Composed View</p>
          <h1 id="page-title">Communications Control Plane</h1>
          <p>
            Governed delivery infrastructure, template catalogues, compliance packs, and fleet health telemetry.
          </p>
        </div>
        <div className={styles.liveBadge} aria-label="Live database connection">
          <span aria-hidden="true" /> Live database
        </div>
      </section>

      {/* Readiness Status Banner */}
      <section className={styles.readinessBanner} aria-labelledby="readiness-title">
        <div>
          <p className={styles.eyebrow}>Operational Readiness</p>
          <h2 id="readiness-title">
            {readyToSend ? "Foundation and provider registry active" : "Provider setup & credentials required"}
          </h2>
          <p>
            {readyToSend
              ? "The governed preflight spine is operational. Messages are dispatched via active connectors."
              : "Register credentials and verify sender identities to activate governed communications."}
          </p>
        </div>
        <span className={readyToSend ? styles.statusReady : styles.statusPending}>
          {readyToSend ? "Ready to Dispatch" : "Setup Required"}
        </span>
      </section>

      {/* Top Aggregates Grid */}
      <section className={styles.metricGrid} aria-label="Communication metrics">
        <article className={styles.metricCard}>
          <span>All Dispatched Deliveries</span>
          <strong>{number(overview.totals.deliveries)}</strong>
          <small>{number(overview.totals.inFlight)} currently in flight</small>
        </article>
        <article className={styles.metricCard}>
          <span>Delivered Messages</span>
          <strong>{number(overview.totals.delivered)}</strong>
          <small>Cryptographically signed delivery evidence</small>
        </article>
        <article className={styles.metricCard}>
          <span>Active Templates</span>
          <strong>{number(overview.readiness.activeTemplates)}</strong>
          <small>{number(overview.readiness.draftTemplates)} drafts in catalogue</small>
        </article>
        <article className={styles.metricCard}>
          <span>Registered Connectors</span>
          <strong>{!isDenied(providers) ? providers.length : 0}</strong>
          <small>{number(overview.readiness.verifiedSenders)} verified senders</small>
        </article>
      </section>

      {/* Section 1: Delivery Infrastructure (Reads Capability Registry) */}
      <section className={styles.panel} aria-labelledby="registry-title">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>1. Delivery Infrastructure · Reads Capability Registry</p>
            <h2 id="registry-title">Provider &amp; Connector Registry</h2>
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <Link href="/configuration/credentials" className={styles.actionLink}>
              Credentials Vault →
            </Link>
            <Link href="/capabilities" className={styles.actionLink}>
              Capability Index →
            </Link>
          </div>
        </div>
        {!isDenied(providers) && providers.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Channels</th>
                  <th>Connector Key</th>
                  <th>Ownership</th>
                  <th>Credential State</th>
                  <th>Health Status</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((c) => (
                  <tr key={c.connectorKey}>
                    <td>
                      <strong style={{ textTransform: 'capitalize' }}>{c.providerKey}</strong>
                      <div style={{ fontSize: '11px', color: 'var(--ink-500)', marginTop: 2 }}>
                        {c.providerType}
                      </div>
                    </td>
                    <td>
                      {c.capabilityKeys.map((k) => (
                        <span key={k} className={styles.tag}>
                          {k.replace('-delivery', '').replace('-', ' ')}
                        </span>
                      ))}
                    </td>
                    <td><code>{c.connectorKey}</code></td>
                    <td style={{ fontSize: 12, color: 'var(--ink-500)' }}>{c.ownershipScope}</td>
                    <td>
                      <span
                        className={c.hasCredential ? styles.stateDefault : styles.stateDraft}
                      >
                        {c.hasCredential ? 'Configured' : 'Missing'}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          c.enabled && c.health === 'HEALTHY'
                            ? styles.stateDefault
                            : c.health === 'UNHEALTHY'
                            ? styles.stateFailed
                            : styles.stateDraft
                        }
                      >
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
            title="No delivery connectors configured"
            description="Configure connectors and credentials in the Capabilities registry to activate delivery routes."
          />
        )}
      </section>

      {/* Section 2: Trigger & Template Catalogue (Reads Comms Templates) */}
      <section className={styles.panel} aria-labelledby="templates-title">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>2. Trigger &amp; Template Catalogue · Reads Communication Domain</p>
            <h2 id="templates-title">Registered Triggers &amp; Layouts</h2>
          </div>
          <Link href="/workflows" className={styles.actionLink}>
            Workflows &amp; Triggers →
          </Link>
        </div>
        {!isDenied(templates) && templates.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Trigger Key</th>
                  <th>Supported Channels</th>
                  <th>Scope</th>
                  <th>Active / Drafts</th>
                  <th>Content Formats</th>
                  <th>Locales</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.triggerKey}>
                    <td><code>{t.triggerKey}</code></td>
                    <td>
                      {t.channels.map((ch) => (
                        <span key={ch} className={styles.tag}>
                          {CHANNEL_LABELS[ch] || ch}
                        </span>
                      ))}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--ink-500)' }}>{t.scope}</td>
                    <td>
                      <span className={t.hasActiveVersion ? styles.stateDefault : styles.stateDraft}>
                        {t.activeCount} Active
                      </span>
                      {t.draftCount > 0 && (
                        <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-500)' }}>
                          ({t.draftCount} draft)
                        </span>
                      )}
                    </td>
                    <td>
                      {t.contentFormats.map((fmt) => (
                        <span key={fmt} className={styles.tag} style={{ fontSize: 10 }}>
                          {fmt}
                        </span>
                      ))}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--ink-500)' }}>
                      {t.locales.join(', ')}
                    </td>
                    <td>
                      <Link href="/configuration/credentials" className={styles.actionLink} style={{ fontSize: 12 }}>
                        Inspect →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No templates catalogued"
            description="Templates and triggers are loaded from the platform communication templates repository."
          />
        )}
      </section>

      {/* Section 3: Compliance Packs (Reads Governance & Compliance) */}
      <div className={styles.twoColumn}>
        <section className={styles.panel} aria-labelledby="compliance-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>3. Compliance Packs · Reads Governance</p>
              <h2 id="compliance-title">Ratified Regulatory Standards</h2>
            </div>
            <Link href="/governance" className={styles.actionLink}>
              Governance Center →
            </Link>
          </div>
          <div style={{ padding: '20px' }}>
            <EmptyState
              title="Compliance packs governed centrally"
              description="Consent, suppression rules, GDPR opt-outs, and TCPA time-window bounds are ratified and managed inside the Governance subsystem."
            />
          </div>
        </section>

        {/* Safety Boundary Policy Card */}
        <section className={styles.panel} aria-labelledby="safety-title">
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Safety &amp; Tenant Isolation</p>
              <h2 id="safety-title">Guaranteed Invariants</h2>
            </div>
          </div>
          <ul className={styles.safetyList}>
            <li>Zero Raw Credentials in DB — References only (KMS/Vault)</li>
            <li>Mandatory preflight consent &amp; suppression checks</li>
            <li>Strict tenant &amp; organization boundary isolation (RLS)</li>
            <li>Idempotent deduplication keys per provider attempt</li>
            <li>Signed webhook delivery verification (Svix / HMAC)</li>
          </ul>
        </section>
      </div>

      {/* Section 4: Fleet Health (7-Day Operational Telemetry) */}
      <section className={styles.panel} aria-labelledby="fleet-title">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>4. Fleet Health · Cross-Tenant 7-Day Telemetry</p>
            <h2 id="fleet-title">Deliverability &amp; Provider Performance</h2>
          </div>
          <span className={styles.muted}>Updated in real-time from outbox workers</span>
        </div>
        {!isDenied(fleet) && fleet.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Connector</th>
                  <th>Channel</th>
                  <th>Total Dispatched</th>
                  <th>In-Flight</th>
                  <th>Delivered</th>
                  <th>Failed / Bounced</th>
                  <th>Delivery Rate</th>
                  <th>Last Event</th>
                </tr>
              </thead>
              <tbody>
                {fleet.map((item) => (
                  <tr key={`${item.connectorKey}-${item.channel}`}>
                    <td><code>{item.connectorKey}</code></td>
                    <td><strong>{CHANNEL_LABELS[item.channel] || item.channel}</strong></td>
                    <td>{number(item.total)}</td>
                    <td>{number(item.inFlight)}</td>
                    <td><span className={styles.stateDefault}>{number(item.delivered)}</span></td>
                    <td>
                      <span className={item.failed > 0 ? styles.stateFailed : undefined}>
                        {number(item.failed)}
                      </span>
                    </td>
                    <td>
                      <strong>
                        {item.deliveryRatePct === null ? '—' : `${item.deliveryRatePct}%`}
                      </strong>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--ink-500)' }}>
                      {dateTime(item.lastEventAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No telemetry records captured"
            description="Fleet statistics will appear as messages are processed across live connectors."
          />
        )}
      </section>
    </>
  );
}
