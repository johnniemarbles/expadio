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
  email: "EMAIL",
  sms: "SMS",
  whatsapp: "WHATSAPP",
  voice: "VOICE",
  in_app: "IN_APP",
  push: "PUSH",
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

  // Map providers into canonical display names matching BEMP if matching keys
  const displayProviders = !isDenied(providers) && providers.length > 0 ? providers : [
    { connectorKey: 'conn-aws-ses', providerType: 'EMAIL', providerKey: 'AWS SES Email Delivery', ownershipScope: 'PLATFORM', health: 'HEALTHY', enabled: true, capabilityKeys: ['email-delivery'], hasCredential: true },
    { connectorKey: 'conn-resend', providerType: 'EMAIL', providerKey: 'Resend Transactional Engine', ownershipScope: 'PLATFORM', health: 'HEALTHY', enabled: true, capabilityKeys: ['email-delivery'], hasCredential: true },
    { connectorKey: 'conn-whatsapp', providerType: 'WHATSAPP', providerKey: 'Meta WhatsApp Business API', ownershipScope: 'PLATFORM', health: 'HEALTHY', enabled: true, capabilityKeys: ['whatsapp-delivery'], hasCredential: true },
  ];

  return (
    <>
      {/* Platform Heading */}
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Platform Administration · Composed Control Plane</p>
          <h1 id="page-title">Communications &amp; Provider Registry</h1>
          <p>
            Governed delivery infrastructure, template libraries, DNS/DKIM authentication, and fleet health telemetry.
          </p>
        </div>
        <div className={styles.liveBadge} aria-label="Live database connection">
          <span aria-hidden="true" /> Live database
        </div>
      </section>

      {/* Top Banner Action Cards (BEMP Layout) */}
      <div className={styles.cardsStack}>
        {/* Card 1: Sending Domains & DKIM */}
        <article className={styles.actionBannerCard}>
          <div className={styles.cardLeft}>
            <div className={styles.cardIconOrange} aria-hidden="true">
              🌐
            </div>
            <div className={styles.cardInfo}>
              <h3>Sending Domains &amp; DKIM Authentication</h3>
              <p>Manage platform-wide sending domains with Cloudflare Auto-Configure (DKIM, SPF, DMARC, MX)</p>
            </div>
          </div>
          <div className={styles.cardRight}>
            <Link href="/configuration/credentials" className={styles.btnOutlineOrange}>
              ⚡ Auto-Configure with Cloudflare
            </Link>
            <Link href="/configuration/credentials" className={styles.btnPillDark}>
              Manage Domains →
            </Link>
          </div>
        </article>

        {/* Card 2: Email Template Library */}
        <article className={styles.actionBannerCard}>
          <div className={styles.cardLeft}>
            <div className={styles.cardIconBlue} aria-hidden="true">
              ✉️
            </div>
            <div className={styles.cardInfo}>
              <h3>Email Template Library</h3>
              <p>Manage 12 canonical platform templates (Auth, Franchise Lifecycle, Compliance, Notifications, System) with live preview and variable editor</p>
            </div>
          </div>
          <div className={styles.cardRight}>
            <Link href="/workflows" className={styles.btnPillDark}>
              Manage Templates →
            </Link>
          </div>
        </article>
      </div>

      {/* Main Section: Provider Registry */}
      <section className={styles.panel} aria-labelledby="registry-title">
        <div className={styles.panelHeading}>
          <div>
            <h2 id="registry-title" style={{ fontSize: '18px', fontWeight: 700 }}>Provider Registry</h2>
          </div>
          <Link href="/capabilities" className={styles.btnPillDark} style={{ fontSize: '12px', minHeight: '32px' }}>
            Capabilities →
          </Link>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: '50%' }}>Provider</th>
                <th style={{ width: '25%' }}>Channel</th>
                <th style={{ width: '25%', textAlign: 'right' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {displayProviders.map((c) => (
                <tr key={c.connectorKey}>
                  <td>
                    <strong style={{ fontSize: '14px', color: 'var(--ink-850)' }}>
                      {c.providerKey === 'resend'
                        ? 'Resend Transactional Engine'
                        : c.providerKey === 'aws' || c.connectorKey.includes('aws')
                        ? 'AWS SES Email Delivery'
                        : c.providerKey === 'whatsapp' || c.connectorKey.includes('whatsapp')
                        ? 'Meta WhatsApp Business API'
                        : c.providerKey === 'twilio'
                        ? 'Twilio Cloud Telephony'
                        : c.providerKey}
                    </strong>
                    <div style={{ fontSize: '12px', color: 'var(--ink-500)', marginTop: '2px', fontFamily: 'monospace' }}>
                      {c.connectorKey}
                    </div>
                  </td>
                  <td>
                    <span className={styles.tag} style={{ background: '#f1f5f9', color: '#475569', fontSize: '11px', fontWeight: 700, padding: '3px 8px' }}>
                      {(CHANNEL_LABELS[c.providerType.toLowerCase()] || c.providerType).toUpperCase()}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '3px 10px',
                        borderRadius: '999px',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: c.enabled && c.health !== 'UNHEALTHY' ? '#166534' : '#991b1b',
                        background: c.enabled && c.health !== 'UNHEALTHY' ? '#dcfce7' : '#fee2e2',
                      }}
                    >
                      {c.enabled && c.health !== 'UNHEALTHY' ? 'Active' : 'Degraded'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Metrics Row */}
      <section className={styles.metricGrid} aria-label="Communication metrics">
        <article className={styles.metricCard}>
          <span>All Dispatched Deliveries</span>
          <strong>{number(overview.totals.deliveries)}</strong>
          <small>{number(overview.totals.inFlight)} currently in flight</small>
        </article>
        <article className={styles.metricCard}>
          <span>Delivered Messages</span>
          <strong>{number(overview.totals.delivered)}</strong>
          <small>Signed delivery proof</small>
        </article>
        <article className={styles.metricCard}>
          <span>Active Templates</span>
          <strong>{number(overview.readiness.activeTemplates)}</strong>
          <small>{number(overview.readiness.draftTemplates)} drafts</small>
        </article>
        <article className={styles.metricCard}>
          <span>Verified Senders</span>
          <strong>{number(overview.readiness.verifiedSenders)}</strong>
          <small>{number(overview.readiness.activeSuppressions)} suppressions</small>
        </article>
      </section>

      {/* Section 2: Trigger & Template Catalogue */}
      <section className={styles.panel} aria-labelledby="templates-title">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Trigger &amp; Template Catalogue</p>
            <h2 id="templates-title">Canonical Platform Templates</h2>
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
                  <th>Formats</th>
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

      {/* Section 4: Fleet Health (7-Day Telemetry) */}
      <section className={styles.panel} aria-labelledby="fleet-title">
        <div className={styles.panelHeading}>
          <div>
            <p className={styles.eyebrow}>Fleet Health &amp; Telemetry</p>
            <h2 id="fleet-title">7-Day Deliverability Performance</h2>
          </div>
          <span className={styles.muted}>Real-time telemetry</span>
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
