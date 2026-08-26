"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { DomainConfigModal } from "./DomainConfigModal";
import { TemplatePreviewModal } from "./TemplatePreviewModal";
import type { ConnectorListItem } from "../../api/communications/providers/route";
import type { TemplateCatalogueItem } from "../../api/communications/templates/route";
import type { FleetHealthItem } from "../../api/communications/fleet/route";
import type { CommunicationOverview } from "../../../lib/communication-contracts";
import { EmptyState } from "@expadio/ui";

const CHANNEL_LABELS: Record<string, string> = {
  email: "EMAIL",
  sms: "SMS",
  whatsapp: "WHATSAPP",
  voice: "VOICE",
  in_app: "IN_APP",
  push: "PUSH",
  rcs: "RCS",
};

interface AttentionTenantItem {
  tenant: string;
  issue: string;
  channel: string;
  impact: string;
  owner: string;
}

const ATTENTION_TENANTS: AttentionTenantItem[] = [
  { tenant: "Northstar Logistics", issue: "Sender domain revoked", channel: "Email", impact: "12.8K queued", owner: "Platform Ops" },
  { tenant: "Dentex Canada", issue: "Business verification pending", channel: "WhatsApp", impact: "Campaign blocked", owner: "Tenant Admin" },
  { tenant: "Urban Realty", issue: "Webhook retry saturation", channel: "SMS", impact: "2.1K delayed", owner: "Integration Ops" },
  { tenant: "Nova TPA", issue: "AI approval queue aging", channel: "AI voice", impact: "38 calls held", owner: "Compliance" },
];

const TRAFFIC_BARS = [
  { label: "Email", volume: "9.4M", heightPct: 92 },
  { label: "SMS", volume: "4.8M", heightPct: 62 },
  { label: "WhatsApp", volume: "3.2M", heightPct: 44 },
  { label: "Voice", volume: "1.8M", heightPct: 28 },
  { label: "AI", volume: "2.6M", heightPct: 38 },
  { label: "Push", volume: "1.1M", heightPct: 22 },
];

interface CommunicationsDashboardClientProps {
  overview: CommunicationOverview;
  initialProviders: ConnectorListItem[];
  templates: TemplateCatalogueItem[];
  fleet: FleetHealthItem[];
}

export function CommunicationsDashboardClient({
  overview,
  initialProviders,
  templates,
  fleet,
}: CommunicationsDashboardClientProps) {
  const [activeTab, setActiveTab] = useState<"fleet" | "tenant_health" | "providers" | "deliverability">("fleet");
  const [providers, setProviders] = useState<ConnectorListItem[]>(initialProviders);
  const [isDomainModalOpen, setIsDomainModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [selectedTriggerKey, setSelectedTriggerKey] = useState<string>("identity.verification.code");
  const [updatingConnector, setUpdatingConnector] = useState<string | null>(null);

  const displayProviders = providers.length > 0 ? providers : [
    { connectorKey: 'conn-aws-ses', providerType: 'EMAIL', providerKey: 'AWS SES Email Delivery', ownershipScope: 'PLATFORM', health: 'HEALTHY', enabled: true, capabilityKeys: ['email-delivery'], hasCredential: true },
    { connectorKey: 'conn-resend', providerType: 'EMAIL', providerKey: 'Resend Transactional Engine', ownershipScope: 'PLATFORM', health: 'HEALTHY', enabled: true, capabilityKeys: ['email-delivery'], hasCredential: true },
    { connectorKey: 'conn-whatsapp', providerType: 'WHATSAPP', providerKey: 'Meta WhatsApp Business API', ownershipScope: 'PLATFORM', health: 'HEALTHY', enabled: true, capabilityKeys: ['whatsapp-delivery'], hasCredential: true },
  ];

  async function handleToggleConnector(connectorKey: string, currentEnabled: boolean) {
    setUpdatingConnector(connectorKey);
    try {
      const res = await fetch(`/api/communications/providers/${encodeURIComponent(connectorKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      if (res.ok) {
        setProviders((prev) =>
          prev.map((p) => (p.connectorKey === connectorKey ? { ...p, enabled: !currentEnabled } : p))
        );
      }
    } catch (err) {
      console.error("Failed to toggle connector:", err);
    } finally {
      setUpdatingConnector(null);
    }
  }

  function handleOpenTemplate(triggerKey: string) {
    setSelectedTriggerKey(triggerKey);
    setIsTemplateModalOpen(true);
  }

  return (
    <div className={styles.dashboardContainer}>
      {/* Top Header Row */}
      <div className={styles.topNavRow}>
        <div>
          <div className={styles.breadcrumbs}>Platform administration / Communications</div>
          <h1 className={styles.commandCenterTitle}>Network command center</h1>
        </div>
        <div className={styles.topActionsGroup}>
          <div className={styles.healthyBadge}>
            <span className={styles.healthyDot} /> Platform healthy
          </div>
          <button
            type="button"
            className={styles.btnExport}
            onClick={() => window.print()}
          >
            Export
          </button>
          <button
            type="button"
            className={styles.btnAddProvider}
            onClick={() => setIsDomainModalOpen(true)}
          >
            <span>+</span> Add provider
          </button>
        </div>
      </div>

      {/* Fleet Title and Region Filter */}
      <div className={styles.fleetHeaderRow}>
        <div className={styles.fleetTitle}>
          <h2>Communication fleet overview</h2>
          <p>Health, throughput and risk across every tenant and channel.</p>
        </div>
        <select className={styles.regionSelect} defaultValue="all">
          <option value="all">All regions</option>
          <option value="na">North America</option>
          <option value="eu">Europe (GDPR)</option>
          <option value="ap">Asia Pacific</option>
        </select>
      </div>

      {/* Navigation Tabs */}
      <div className={styles.tabsList} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "fleet"}
          className={[styles.tabItem, activeTab === "fleet" ? styles.tabItemActive : ""].join(" ")}
          onClick={() => setActiveTab("fleet")}
        >
          Fleet overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "tenant_health"}
          className={[styles.tabItem, activeTab === "tenant_health" ? styles.tabItemActive : ""].join(" ")}
          onClick={() => setActiveTab("tenant_health")}
        >
          Tenant health
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "providers"}
          className={[styles.tabItem, activeTab === "providers" ? styles.tabItemActive : ""].join(" ")}
          onClick={() => setActiveTab("providers")}
        >
          Provider control
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "deliverability"}
          className={[styles.tabItem, activeTab === "deliverability" ? styles.tabItemActive : ""].join(" ")}
          onClick={() => setActiveTab("deliverability")}
        >
          Deliverability
        </button>
      </div>

      {/* Tab Content: Fleet Overview (Default PDF View) */}
      {(activeTab === "fleet" || activeTab === "tenant_health") && (
        <>
          {/* 3 Summary Metrics */}
          <div className={styles.summaryMetricsGrid}>
            <article className={styles.summaryMetricCard}>
              <span>Active tenants</span>
              <strong>186</strong>
              <small>172 production-ready</small>
            </article>
            <article className={styles.summaryMetricCard}>
              <span>Delivery events</span>
              <strong>18.4M</strong>
              <small>Across six channels</small>
            </article>
            <article className={styles.summaryMetricCard}>
              <span>Platform success rate</span>
              <strong>98.1%</strong>
              <small>0.6% above SLA</small>
            </article>
          </div>

          {/* Middle 2-Column Section */}
          <div className={styles.twoColGrid}>
            {/* Cross-Channel Traffic Bar Chart */}
            <article className={styles.cardPanel}>
              <div className={styles.cardPanelHeader}>
                <div>
                  <h3>Cross-channel traffic</h3>
                  <p>Millions of events · last 30 days</p>
                </div>
                <select className={styles.timeFilterSelect} defaultValue="30d">
                  <option value="30d">30 days</option>
                  <option value="7d">7 days</option>
                  <option value="90d">90 days</option>
                </select>
              </div>

              <div className={styles.barChartContainer}>
                {TRAFFIC_BARS.map((bar) => (
                  <div key={bar.label} className={styles.barCol}>
                    <div
                      className={styles.barFill}
                      style={{ height: `${bar.heightPct}%` }}
                      title={`${bar.label}: ${bar.volume}`}
                    />
                    <span className={styles.barLabel}>{bar.label}</span>
                  </div>
                ))}
              </div>
            </article>

            {/* Channel Operations */}
            <article className={styles.cardPanel}>
              <div className={styles.cardPanelHeader}>
                <div>
                  <h3>Channel operations</h3>
                  <p>Readiness across the platform</p>
                </div>
              </div>

              <div className={styles.channelOpsList}>
                {/* Email */}
                <div className={styles.channelOpRow}>
                  <div className={styles.channelOpLeft}>
                    <div className={styles.channelIconWrap}>✉️</div>
                    <div className={styles.channelOpTitle}>
                      <strong>Email</strong>
                      <small>184 tenants · 6 providers</small>
                    </div>
                  </div>
                  <span className={styles.badgeHealthy}>
                    <span>✓</span> Healthy
                  </span>
                </div>

                {/* SMS */}
                <div className={styles.channelOpRow}>
                  <div className={styles.channelOpLeft}>
                    <div className={styles.channelIconWrap}>💬</div>
                    <div className={styles.channelOpTitle}>
                      <strong>SMS</strong>
                      <small>141 tenants · 3 providers</small>
                    </div>
                  </div>
                  <span className={styles.badgeHealthy}>
                    <span>✓</span> Healthy
                  </span>
                </div>

                {/* Voice & AI */}
                <div className={styles.channelOpRow}>
                  <div className={styles.channelOpLeft}>
                    <div className={styles.channelIconWrap}>📞</div>
                    <div className={styles.channelOpTitle}>
                      <strong>Voice &amp; AI</strong>
                      <small>67 tenants · guarded execution</small>
                    </div>
                  </div>
                  <span className={styles.badgeHealthy}>
                    <span>✓</span> Healthy
                  </span>
                </div>

                {/* WhatsApp */}
                <div className={styles.channelOpRow}>
                  <div className={styles.channelOpLeft}>
                    <div className={styles.channelIconWrap}>📱</div>
                    <div className={styles.channelOpTitle}>
                      <strong>WhatsApp</strong>
                      <small>18 tenants need verification</small>
                    </div>
                  </div>
                  <span className={styles.badgeAttention}>
                    <span>⚠️</span> Attention
                  </span>
                </div>
              </div>
            </article>
          </div>

          {/* Tenants Needing Attention Table (Page 2) */}
          <section className={styles.attentionTablePanel}>
            <div className={styles.attentionPanelHeading}>
              <div>
                <h3>Tenants needing attention</h3>
                <p>Sorted by operational impact</p>
              </div>
              <button
                type="button"
                className={styles.btnOpenQueue}
                onClick={() => setIsDomainModalOpen(true)}
              >
                Open queue
              </button>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Issue</th>
                    <th>Channel</th>
                    <th>Impact</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {ATTENTION_TENANTS.map((item, idx) => (
                    <tr key={idx}>
                      <td><strong>{item.tenant}</strong></td>
                      <td>{item.issue}</td>
                      <td>
                        <span className={styles.tag}>{item.channel}</span>
                      </td>
                      <td style={{ color: "#b91c1c", fontWeight: 600 }}>{item.impact}</td>
                      <td style={{ color: "var(--ink-600, #475569)" }}>{item.owner}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Tab Content: Provider Control */}
      {activeTab === "providers" && (
        <>
          <div className={styles.cardsStack}>
            {/* Card 1: Sending Domains & DKIM */}
            <article className={styles.actionBannerCard}>
              <div className={styles.cardLeft}>
                <div className={styles.cardIconOrange} aria-hidden="true">🌐</div>
                <div className={styles.cardInfo}>
                  <h3>Sending Domains &amp; DKIM Authentication</h3>
                  <p>Manage platform-wide sending domains with Cloudflare Auto-Configure (DKIM, SPF, DMARC, MX)</p>
                </div>
              </div>
              <div className={styles.cardRight}>
                <button
                  type="button"
                  onClick={() => setIsDomainModalOpen(true)}
                  className={styles.btnOutlineOrange}
                >
                  ⚡ Auto-Configure with Cloudflare
                </button>
                <button
                  type="button"
                  onClick={() => setIsDomainModalOpen(true)}
                  className={styles.btnPillDark}
                >
                  Manage Domains →
                </button>
              </div>
            </article>

            {/* Card 2: Email Template Library */}
            <article className={styles.actionBannerCard}>
              <div className={styles.cardLeft}>
                <div className={styles.cardIconBlue} aria-hidden="true">✉️</div>
                <div className={styles.cardInfo}>
                  <h3>Email Template Library</h3>
                  <p>Manage 12 canonical platform templates (Auth, Franchise Lifecycle, Compliance, Notifications, System) with live preview and variable editor</p>
                </div>
              </div>
              <div className={styles.cardRight}>
                <button
                  type="button"
                  onClick={() => handleOpenTemplate(templates[0]?.triggerKey || "identity.verification.code")}
                  className={styles.btnPillDark}
                >
                  Manage Templates →
                </button>
              </div>
            </article>
          </div>

          <section className={styles.attentionTablePanel}>
            <div className={styles.attentionPanelHeading}>
              <div>
                <h3>Provider Registry</h3>
                <p>Governed connector instances and routing status</p>
              </div>
              <Link href="/capabilities" className={styles.btnOpenQueue}>
                Capabilities →
              </Link>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: "50%" }}>Provider</th>
                    <th style={{ width: "25%" }}>Channel</th>
                    <th style={{ width: "25%", textAlign: "right" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {displayProviders.map((c) => (
                    <tr key={c.connectorKey}>
                      <td>
                        <strong style={{ fontSize: "14px", color: "var(--ink-850)" }}>
                          {c.providerKey === "resend"
                            ? "Resend Transactional Engine"
                            : c.providerKey === "aws" || c.connectorKey.includes("aws")
                            ? "AWS SES Email Delivery"
                            : c.providerKey === "whatsapp" || c.connectorKey.includes("whatsapp")
                            ? "Meta WhatsApp Business API"
                            : c.providerKey === "twilio"
                            ? "Twilio Cloud Telephony"
                            : c.providerKey}
                        </strong>
                        <div style={{ fontSize: "12px", color: "var(--ink-500)", marginTop: "2px", fontFamily: "monospace" }}>
                          {c.connectorKey}
                        </div>
                      </td>
                      <td>
                        <span className={styles.tag} style={{ background: "#f1f5f9", color: "#475569", fontSize: "11px", fontWeight: 700, padding: "3px 8px" }}>
                          {(CHANNEL_LABELS[c.providerType.toLowerCase()] || c.providerType).toUpperCase()}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={() => handleToggleConnector(c.connectorKey, c.enabled)}
                          disabled={updatingConnector === c.connectorKey}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "3px 10px",
                            borderRadius: "999px",
                            border: 0,
                            cursor: "pointer",
                            fontSize: "12px",
                            fontWeight: 700,
                            color: c.enabled && c.health !== "UNHEALTHY" ? "#166534" : "#991b1b",
                            background: c.enabled && c.health !== "UNHEALTHY" ? "#dcfce7" : "#fee2e2",
                          }}
                        >
                          {updatingConnector === c.connectorKey
                            ? "Updating..."
                            : c.enabled && c.health !== "UNHEALTHY"
                            ? "Active"
                            : "Degraded"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Tab Content: Deliverability */}
      {activeTab === "deliverability" && (
        <section className={styles.attentionTablePanel}>
          <div className={styles.attentionPanelHeading}>
            <div>
              <h3>7-Day Deliverability Performance</h3>
              <p>Real-time cross-tenant telemetry across active channels</p>
            </div>
          </div>
          {fleet.length > 0 ? (
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
                  </tr>
                </thead>
                <tbody>
                  {fleet.map((item) => (
                    <tr key={`${item.connectorKey}-${item.channel}`}>
                      <td><code>{item.connectorKey}</code></td>
                      <td><strong>{CHANNEL_LABELS[item.channel] || item.channel}</strong></td>
                      <td>{item.total}</td>
                      <td>{item.inFlight}</td>
                      <td><span style={{ color: "#166534", fontWeight: 700 }}>{item.delivered}</span></td>
                      <td>
                        <span style={{ color: item.failed > 0 ? "#b91c1c" : undefined }}>
                          {item.failed}
                        </span>
                      </td>
                      <td>
                        <strong>{item.deliveryRatePct === null ? "—" : `${item.deliveryRatePct}%`}</strong>
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
      )}

      {/* Interactive Modals */}
      <DomainConfigModal
        isOpen={isDomainModalOpen}
        onClose={() => setIsDomainModalOpen(false)}
      />
      <TemplatePreviewModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        triggerKey={selectedTriggerKey}
      />
    </div>
  );
}
