"use client";

import { useMemo, useState } from "react";
import type { CommunicationOverview } from "../../../lib/communication-contracts";
import type { ConnectorListItem } from "../../api/communications/providers/route";
import type { FleetHealthItem } from "../../api/communications/fleet/route";
import type { TemplateCatalogueItem } from "../../api/communications/templates/route";
import styles from "./page.module.css";

type DashboardTab =
  | "overview"
  | "providers"
  | "templates"
  | "deliverability"
  | "activity"
  | "readiness";

const TABS: readonly { key: DashboardTab; label: string }[] = [
  { key: "overview", label: "Fleet overview" },
  { key: "providers", label: "Provider control" },
  { key: "templates", label: "Templates" },
  { key: "deliverability", label: "Deliverability" },
  { key: "activity", label: "Delivery activity" },
  { key: "readiness", label: "Readiness" },
];

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  voice: "Voice",
  in_app: "In-app",
  push: "Push",
  rcs: "RCS",
  ai: "AI agent",
};

function number(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}

function dateTime(value: string | null): string {
  if (!value) return "No events";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function percentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.max(4, Math.round((value / total) * 100));
}

function providerState(provider: ConnectorListItem): "Ready" | "Action required" | "Disabled" {
  if (!provider.enabled) return "Disabled";
  if (!provider.hasCredential || provider.health === "UNHEALTHY") return "Action required";
  return "Ready";
}

export function CommunicationsDashboard({
  overview,
  providers,
  templates,
  fleet,
}: {
  overview: CommunicationOverview;
  providers: readonly ConnectorListItem[];
  templates: readonly TemplateCatalogueItem[];
  fleet: readonly FleetHealthItem[];
}) {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");

  const enabledProviders = providers.filter((provider) => provider.enabled);
  const readyProviders = providers.filter((provider) => providerState(provider) === "Ready");
  const sendingEnabled = readyProviders.length > 0;
  const totalFleetEvents = fleet.reduce((sum, item) => sum + item.total, 0);
  const totalFleetDelivered = fleet.reduce((sum, item) => sum + item.delivered, 0);
  const totalFleetFailed = fleet.reduce((sum, item) => sum + item.failed, 0);
  const fleetDeliveryRate =
    totalFleetEvents === 0 ? null : Math.round((totalFleetDelivered / totalFleetEvents) * 1000) / 10;

  const channelTotals = useMemo(() => {
    const values = new Map<string, number>();
    for (const item of fleet) {
      values.set(item.channel, (values.get(item.channel) ?? 0) + item.total);
    }
    if (values.size === 0) {
      for (const item of overview.channels) values.set(item.channel, item.total);
    }
    return [...values.entries()].sort((left, right) => right[1] - left[1]);
  }, [fleet, overview.channels]);

  const largestChannel = Math.max(1, ...channelTotals.map(([, total]) => total));

  return (
    <>
      <section className={styles.pageHeading} aria-labelledby="page-title">
        <div>
          <p className={styles.eyebrow}>Platform administration · Communications</p>
          <h1 id="page-title">Network command center</h1>
          <p>Govern providers, templates, delivery health and channel readiness from one platform workspace.</p>
        </div>
        <div className={styles.headingActions}>
          <span className={styles.liveBadge}><span aria-hidden="true" />Live database</span>
          <a className={styles.secondaryButton} href="/configuration/credentials">Provider setup</a>
        </div>
      </section>

      <section
        className={sendingEnabled ? styles.operationalBanner : styles.blockedBanner}
        aria-label="Outbound communication readiness"
      >
        <div>
          <strong>{sendingEnabled ? "Outbound transport operational" : "Sending disabled"}</strong>
          <p>
            {sendingEnabled
              ? `${readyProviders.length} provider connection${readyProviders.length === 1 ? "" : "s"} have credentials and are ready for governed routing.`
              : "No enabled provider currently has the required credential and healthy state. Configuration remains available, but outbound sending is blocked."}
          </p>
        </div>
        <span className={sendingEnabled ? styles.stateReady : styles.stateAttention}>
          {sendingEnabled ? "Operational" : "Setup required"}
        </span>
      </section>

      <nav className={styles.dashboardTabs} role="tablist" aria-label="Communication dashboards">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`communications-panel-${tab.key}`}
            className={activeTab === tab.key ? styles.dashboardTabActive : styles.dashboardTab}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "overview" && (
        <section id="communications-panel-overview" role="tabpanel" className={styles.dashboardPanel}>
          <div className={styles.metricGrid}>
            <article className={styles.metricCard}>
              <span>Fleet delivery events</span>
              <strong>{number(totalFleetEvents || overview.totals.deliveries)}</strong>
              <small>{number(overview.totals.inFlight)} currently in flight</small>
            </article>
            <article className={styles.metricCard}>
              <span>Delivery rate</span>
              <strong>{fleetDeliveryRate === null ? "—" : `${fleetDeliveryRate}%`}</strong>
              <small>{number(totalFleetFailed || overview.totals.failed)} failed or bounced</small>
            </article>
            <article className={styles.metricCard}>
              <span>Provider readiness</span>
              <strong>{readyProviders.length}/{providers.length}</strong>
              <small>{enabledProviders.length} enabled connections</small>
            </article>
            <article className={styles.metricCard}>
              <span>Active templates</span>
              <strong>{number(overview.readiness.activeTemplates)}</strong>
              <small>{number(overview.readiness.draftTemplates)} drafts awaiting publication</small>
            </article>
          </div>

          <div className={styles.dashboardGrid}>
            <article className={styles.panel}>
              <div className={styles.panelHeading}>
                <div><p className={styles.eyebrow}>Channel distribution</p><h2>Communication traffic</h2></div>
                <span className={styles.muted}>Live delivery ledger</span>
              </div>
              <div className={styles.barChart} aria-label="Delivery volume by channel">
                {channelTotals.length > 0 ? channelTotals.map(([channel, total]) => (
                  <div className={styles.barRow} key={channel}>
                    <span>{CHANNEL_LABELS[channel] ?? channel}</span>
                    <div className={styles.barTrack}><span style={{ width: `${percentage(total, largestChannel)}%` }} /></div>
                    <strong>{number(total)}</strong>
                  </div>
                )) : <p className={styles.emptyMessage}>No channel traffic has been recorded.</p>}
              </div>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeading}>
                <div><p className={styles.eyebrow}>Control plane</p><h2>Operational readiness</h2></div>
              </div>
              <dl className={styles.readinessList}>
                <div><dt>Verified senders</dt><dd>{number(overview.readiness.verifiedSenders)}</dd></div>
                <div><dt>Pending senders</dt><dd>{number(overview.readiness.pendingSenders)}</dd></div>
                <div><dt>Active suppressions</dt><dd>{number(overview.readiness.activeSuppressions)}</dd></div>
                <div><dt>Credentialed providers</dt><dd>{providers.filter((item) => item.hasCredential).length}</dd></div>
              </dl>
            </article>
          </div>
        </section>
      )}

      {activeTab === "providers" && (
        <section id="communications-panel-providers" role="tabpanel" className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><p className={styles.eyebrow}>Provider control plane</p><h2>Connector inventory</h2></div>
            <a href="/configuration/credentials" className={styles.actionLink}>Manage credentials →</a>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Provider</th><th>Channel</th><th>Scope</th><th>Credential</th><th>Status</th></tr></thead>
              <tbody>
                {providers.map((provider) => {
                  const state = providerState(provider);
                  return <tr key={provider.connectorKey}>
                    <td><strong>{provider.providerKey}</strong><small className={styles.cellMeta}>{provider.connectorKey}</small></td>
                    <td>{CHANNEL_LABELS[provider.providerType.toLowerCase()] ?? provider.providerType}</td>
                    <td>{provider.ownershipScope}</td>
                    <td>{provider.hasCredential ? "Bound" : "Missing"}</td>
                    <td><span className={state === "Ready" ? styles.stateDefault : state === "Disabled" ? styles.stateDraft : styles.stateFailed}>{state}</span></td>
                  </tr>;
                })}
                {providers.length === 0 && <tr><td colSpan={5} className={styles.emptyCell}>No communication providers are registered.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "templates" && (
        <section id="communications-panel-templates" role="tabpanel" className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><p className={styles.eyebrow}>Authoring foundation</p><h2>Canonical template catalogue</h2></div>
            <a href="/workflows" className={styles.actionLink}>Workflow triggers →</a>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Trigger</th><th>Channels</th><th>Scope</th><th>Versions</th><th>Locales</th><th>Status</th></tr></thead>
              <tbody>
                {templates.map((template) => <tr key={`${template.scope}-${template.triggerKey}`}>
                  <td><code>{template.triggerKey}</code></td>
                  <td>{template.channels.map((channel) => <span className={styles.tag} key={channel}>{CHANNEL_LABELS[channel] ?? channel}</span>)}</td>
                  <td>{template.scope}</td>
                  <td>{template.totalVersions}</td>
                  <td>{template.locales.join(", ")}</td>
                  <td><span className={template.hasActiveVersion ? styles.stateDefault : styles.stateDraft}>{template.hasActiveVersion ? "Active" : "Draft only"}</span></td>
                </tr>)}
                {templates.length === 0 && <tr><td colSpan={6} className={styles.emptyCell}>No templates are catalogued.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "deliverability" && (
        <section id="communications-panel-deliverability" role="tabpanel" className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><p className={styles.eyebrow}>Fleet telemetry</p><h2>Connector deliverability</h2></div>
            <span className={styles.muted}>Rolling seven days</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Connector</th><th>Channel</th><th>Total</th><th>Delivered</th><th>Failed</th><th>Rate</th><th>Last event</th></tr></thead>
              <tbody>
                {fleet.map((item) => <tr key={`${item.connectorKey}-${item.channel}`}>
                  <td><code>{item.connectorKey}</code></td>
                  <td>{CHANNEL_LABELS[item.channel] ?? item.channel}</td>
                  <td>{number(item.total)}</td>
                  <td>{number(item.delivered)}</td>
                  <td><span className={item.failed > 0 ? styles.stateFailed : undefined}>{number(item.failed)}</span></td>
                  <td>{item.deliveryRatePct === null ? "—" : `${item.deliveryRatePct}%`}</td>
                  <td>{dateTime(item.lastEventAt)}</td>
                </tr>)}
                {fleet.length === 0 && <tr><td colSpan={7} className={styles.emptyCell}>No fleet telemetry is available.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "activity" && (
        <section id="communications-panel-activity" role="tabpanel" className={styles.panel}>
          <div className={styles.panelHeading}>
            <div><p className={styles.eyebrow}>Delivery lifecycle</p><h2>Recent communication events</h2></div>
            <span className={styles.muted}>Recipient addresses are never exposed</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Delivery</th><th>Channel</th><th>Connector</th><th>State</th><th>Attempts</th><th>Updated</th></tr></thead>
              <tbody>
                {overview.recentDeliveries.map((delivery) => <tr key={delivery.id}>
                  <td><code>{delivery.id}</code></td>
                  <td>{CHANNEL_LABELS[delivery.channel] ?? delivery.channel}</td>
                  <td>{delivery.connectorKey}</td>
                  <td><span className={delivery.state === "DELIVERED" ? styles.stateDefault : delivery.state === "FAILED" || delivery.state === "BOUNCED" ? styles.stateFailed : styles.stateDraft}>{delivery.state}</span></td>
                  <td>{delivery.attemptCount}</td>
                  <td>{dateTime(delivery.updatedAt)}</td>
                </tr>)}
                {overview.recentDeliveries.length === 0 && <tr><td colSpan={6} className={styles.emptyCell}>No delivery events have been recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "readiness" && (
        <section id="communications-panel-readiness" role="tabpanel" className={styles.dashboardGrid}>
          <article className={styles.panel}>
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Sending infrastructure</p><h2>Domains and sender identities</h2></div><a href="/configuration/credentials" className={styles.actionLink}>Configure →</a></div>
            <dl className={styles.readinessList}>
              <div><dt>Verified sender identities</dt><dd>{overview.readiness.verifiedSenders}</dd></div>
              <div><dt>Pending verification</dt><dd>{overview.readiness.pendingSenders}</dd></div>
              <div><dt>Provider credentials</dt><dd>{providers.filter((provider) => provider.hasCredential).length}</dd></div>
            </dl>
          </article>
          <article className={styles.panel}>
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Governance</p><h2>Safety controls</h2></div></div>
            <ul className={styles.safetyList}>
              <li>Consent is evaluated before dispatch.</li>
              <li>Suppression is enforced across every channel.</li>
              <li>Provider delivery events are reconciled idempotently.</li>
              <li>AI and voice intelligence remain governed by the AI layer.</li>
            </ul>
          </article>
        </section>
      )}
    </>
  );
}
