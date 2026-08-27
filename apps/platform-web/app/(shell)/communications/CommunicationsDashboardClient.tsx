"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { DomainConfigModal } from "./DomainConfigModal";
import { TemplateLibraryModal } from "./TemplateLibraryModal";
import { ProviderModal } from "./ProviderModal";
import type { ConnectorListItem } from "../../api/communications/providers/route";
import type { TemplateCatalogueItem } from "../../api/communications/templates/route";
import type { FleetHealthItem } from "../../api/communications/fleet/route";
import type { CommunicationOverview } from "../../../lib/communication-contracts";
import { EmptyState } from "@expadio/ui";

const CHANNEL_LABELS: Record<string, string> = { email: "EMAIL", sms: "SMS", whatsapp: "WHATSAPP", voice: "VOICE", in_app: "IN_APP", push: "PUSH", rcs: "RCS" };
const CHANNEL_ICONS: Record<string, string> = { email: "✉️", sms: "💬", whatsapp: "📱", voice: "📞", in_app: "🔔", push: "📣", rcs: "💬" };

function formatCount(value: number) {
  return new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard" }).format(value);
}

interface CommunicationsDashboardClientProps {
  overview: CommunicationOverview;
  initialProviders: ConnectorListItem[];
  templates: TemplateCatalogueItem[];
  fleet: FleetHealthItem[];
}

export function CommunicationsDashboardClient({ overview, initialProviders, templates, fleet }: CommunicationsDashboardClientProps) {
  const [activeTab, setActiveTab] = useState<"fleet" | "tenant_health" | "providers" | "deliverability">("fleet");
  const [providers, setProviders] = useState<ConnectorListItem[]>(initialProviders);
  const [isDomainModalOpen, setIsDomainModalOpen] = useState(false);
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [isTemplateLibraryOpen, setIsTemplateLibraryOpen] = useState(false);
  const [updatingConnector, setUpdatingConnector] = useState<string | null>(null);

  const successRate = overview.totals.deliveries === 0 ? null : Math.round((overview.totals.delivered / overview.totals.deliveries) * 1000) / 10;
  const maximumChannelVolume = Math.max(0, ...overview.channels.map((channel) => channel.total));
  const trafficBars = overview.channels.map((channel) => ({ label: CHANNEL_LABELS[channel.channel] || channel.channel, volume: formatCount(channel.total), heightPct: maximumChannelVolume === 0 ? 0 : Math.max(6, (channel.total / maximumChannelVolume) * 100) }));
  const operationalAlerts = overview.recentDeliveries.filter((delivery) => ["FAILED", "BOUNCED", "COMPLAINED", "CANCELLED"].includes(delivery.state));
  const degradedProviders = providers.filter((provider) => !provider.enabled || provider.health === "UNHEALTHY");
  const platformStatus = degradedProviders.length > 0 || overview.totals.failed > 0 ? "Attention required" : "Operational data live";

  async function reloadProviders() {
    const response = await fetch("/api/communications/providers");
    if (!response.ok) return;
    const next = await response.json();
    if (Array.isArray(next)) setProviders(next);
  }

  async function handleToggleConnector(connectorKey: string, currentEnabled: boolean) {
    setUpdatingConnector(connectorKey);
    try {
      const res = await fetch(`/api/communications/providers/${encodeURIComponent(connectorKey)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !currentEnabled }) });
      if (res.ok) setProviders((prev) => prev.map((p) => (p.connectorKey === connectorKey ? { ...p, enabled: !currentEnabled } : p)));
    } catch (err) { console.error("Failed to toggle connector:", err); }
    finally { setUpdatingConnector(null); }
  }

  return (
    <div className={styles.dashboardContainer}>
      <div className={styles.topNavRow}><div><div className={styles.breadcrumbs}>Platform administration / Communications</div><h1 className={styles.commandCenterTitle}>Network command center</h1></div><div className={styles.topActionsGroup}><div className={styles.healthyBadge}><span className={styles.healthyDot} /> {platformStatus}</div><button type="button" className={styles.btnExport} onClick={() => window.print()}>Export</button><button type="button" className={styles.btnAddProvider} onClick={() => setIsProviderModalOpen(true)}><span>+</span> Add provider</button></div></div>
      <div className={styles.fleetHeaderRow}><div className={styles.fleetTitle}><h2>Communication fleet overview</h2><p>Health, throughput and risk across every tenant and channel.</p></div><span className={styles.dataTimestamp}>Live snapshot · {new Date(overview.capturedAt).toLocaleString()}</span></div>
      <div className={styles.tabsList} role="tablist">
        {([["fleet", "Fleet overview"], ["tenant_health", "Tenant health"], ["providers", "Provider control"], ["deliverability", "Deliverability"]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={activeTab === key} className={[styles.tabItem, activeTab === key ? styles.tabItemActive : ""].join(" ")} onClick={() => setActiveTab(key)}>{label}</button>)}
      </div>

      {(activeTab === "fleet" || activeTab === "tenant_health") && <><div className={styles.summaryMetricsGrid}><article className={styles.summaryMetricCard}><span>Configured providers</span><strong>{formatCount(providers.length)}</strong><small>{providers.filter((provider) => provider.enabled).length} enabled</small></article><article className={styles.summaryMetricCard}><span>Delivery events</span><strong>{formatCount(overview.totals.deliveries)}</strong><small>{overview.channels.filter((channel) => channel.total > 0).length} active channels</small></article><article className={styles.summaryMetricCard}><span>Delivery success rate</span><strong>{successRate === null ? "—" : `${successRate}%`}</strong><small>{overview.totals.failed} failed · {overview.totals.inFlight} in flight</small></article></div><div className={styles.twoColGrid}><article className={styles.cardPanel}><div className={styles.cardPanelHeader}><div><h3>Cross-channel traffic</h3><p>Live retained delivery totals by channel</p></div></div><div className={styles.barChartContainer}>{trafficBars.map((bar) => <div key={bar.label} className={styles.barCol}><div className={styles.barFill} style={{ height: `${bar.heightPct}%` }} title={`${bar.label}: ${bar.volume}`} /><span className={styles.barLabel}>{bar.label}</span></div>)}</div></article><article className={styles.cardPanel}><div className={styles.cardPanelHeader}><div><h3>Channel operations</h3><p>Readiness across the platform</p></div></div><div className={styles.channelOpsList}>{overview.channels.map((channel) => { const channelProviders = providers.filter((provider) => provider.providerType.toLowerCase() === channel.channel); const needsAttention = channel.failed > 0 || channelProviders.some((provider) => !provider.enabled || provider.health === "UNHEALTHY"); return <div key={channel.channel} className={styles.channelOpRow}><div className={styles.channelOpLeft}><div className={styles.channelIconWrap}>{CHANNEL_ICONS[channel.channel] || "•"}</div><div className={styles.channelOpTitle}><strong>{CHANNEL_LABELS[channel.channel] || channel.channel}</strong><small>{formatCount(channel.total)} events · {channelProviders.length} providers</small></div></div><span className={needsAttention ? styles.badgeAttention : styles.badgeHealthy}><span>{needsAttention ? "⚠" : "✓"}</span>{channel.total === 0 && channelProviders.length === 0 ? "Not configured" : needsAttention ? "Attention" : "Healthy"}</span></div>; })}</div></article></div><section className={styles.attentionTablePanel}><div className={styles.attentionPanelHeading}><div><h3>Operational attention</h3><p>Recent failed, bounced, complained or cancelled deliveries</p></div><span className={styles.tag}>{operationalAlerts.length} records</span></div>{operationalAlerts.length > 0 ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Delivery</th><th>Connector</th><th>Channel</th><th>State</th><th>Reason</th></tr></thead><tbody>{operationalAlerts.map((item) => <tr key={item.id}><td><code>{item.id}</code></td><td><code>{item.connectorKey}</code></td><td><span className={styles.tag}>{item.channel}</span></td><td style={{ color: "#b91c1c", fontWeight: 700 }}>{item.state}</td><td>{item.reasonCode || "No provider reason supplied"}</td></tr>)}</tbody></table></div> : <EmptyState title="No recent delivery failures" description="Operational incidents will appear here from the live delivery lifecycle." />}</section></>}

      {activeTab === "providers" && <><div className={styles.cardsStack}><article className={styles.actionBannerCard}><div className={styles.cardLeft}><div className={styles.cardIconOrange} aria-hidden="true">🌐</div><div className={styles.cardInfo}><h3>Sending Domains &amp; DKIM Authentication</h3><p>Manage platform-wide sending domains with Cloudflare Auto-Configure (DKIM, SPF, DMARC, MX)</p></div></div><div className={styles.cardRight}><button type="button" onClick={() => setIsDomainModalOpen(true)} className={styles.btnOutlineOrange}>⚡ Auto-Configure with Cloudflare</button><button type="button" onClick={() => setIsDomainModalOpen(true)} className={styles.btnPillDark}>Manage Domains →</button></div></article><article className={styles.actionBannerCard}><div className={styles.cardLeft}><div className={styles.cardIconBlue} aria-hidden="true">✉️</div><div className={styles.cardInfo}><h3>Email Template Library</h3><p>Manage {templates.length} live platform templates with preview, variables, and tenant cloning.</p></div></div><div className={styles.cardRight}><button type="button" onClick={() => setIsTemplateLibraryOpen(true)} className={styles.btnPillDark}>Manage Templates →</button></div></article></div><section className={styles.attentionTablePanel}><div className={styles.attentionPanelHeading}><div><h3>Provider Registry</h3><p>Governed connector instances and routing status</p></div><Link href="/capabilities" className={styles.btnOpenQueue}>Capabilities →</Link></div>{providers.length > 0 ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th style={{ width: "50%" }}>Provider</th><th style={{ width: "25%" }}>Channel</th><th style={{ width: "25%", textAlign: "right" }}>Status</th></tr></thead><tbody>{providers.map((c) => <tr key={c.connectorKey}><td><strong style={{ fontSize: 14, color: "var(--ink-850)" }}>{c.providerKey === "resend" ? "Resend Transactional Engine" : c.providerKey === "aws" || c.connectorKey.includes("aws") ? "AWS SES Email Delivery" : c.providerKey === "whatsapp" || c.connectorKey.includes("whatsapp") ? "Meta WhatsApp Business API" : c.providerKey === "twilio" ? "Twilio Cloud Telephony" : c.providerKey}</strong><div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2, fontFamily: "monospace" }}>{c.connectorKey}</div></td><td><span className={styles.tag} style={{ background: "#f1f5f9", color: "#475569", fontSize: 11, fontWeight: 700, padding: "3px 8px" }}>{(CHANNEL_LABELS[c.providerType.toLowerCase()] || c.providerType).toUpperCase()}</span></td><td style={{ textAlign: "right" }}><button type="button" onClick={() => handleToggleConnector(c.connectorKey, c.enabled)} disabled={updatingConnector === c.connectorKey} style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: "999px", border: 0, cursor: "pointer", fontSize: 12, fontWeight: 700, color: c.enabled && c.health !== "UNHEALTHY" ? "#166534" : "#991b1b", background: c.enabled && c.health !== "UNHEALTHY" ? "#dcfce7" : "#fee2e2" }}>{updatingConnector === c.connectorKey ? "Updating..." : c.enabled && c.health !== "UNHEALTHY" ? "Active" : "Degraded"}</button></td></tr>)}</tbody></table></div> : <EmptyState title="No communication providers configured" description="Register a governed connector to make it available for routing." />}</section></>}

      {activeTab === "deliverability" && <section className={styles.attentionTablePanel}><div className={styles.attentionPanelHeading}><div><h3>7-Day Deliverability Performance</h3><p>Real-time cross-tenant telemetry across active channels</p></div></div>{fleet.length > 0 ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Connector</th><th>Channel</th><th>Total Dispatched</th><th>In-Flight</th><th>Delivered</th><th>Failed / Bounced</th><th>Delivery Rate</th></tr></thead><tbody>{fleet.map((item) => <tr key={`${item.connectorKey}-${item.channel}`}><td><code>{item.connectorKey}</code></td><td><strong>{CHANNEL_LABELS[item.channel] || item.channel}</strong></td><td>{item.total}</td><td>{item.inFlight}</td><td><span style={{ color: "#166534", fontWeight: 700 }}>{item.delivered}</span></td><td><span style={{ color: item.failed > 0 ? "#b91c1c" : undefined }}>{item.failed}</span></td><td><strong>{item.deliveryRatePct === null ? "—" : `${item.deliveryRatePct}%`}</strong></td></tr>)}</tbody></table></div> : <EmptyState title="No telemetry records captured" description="Fleet statistics will appear as messages are processed across live connectors." />}</section>}

      <ProviderModal isOpen={isProviderModalOpen} onClose={() => setIsProviderModalOpen(false)} onCreated={reloadProviders} />
      <DomainConfigModal isOpen={isDomainModalOpen} onClose={() => setIsDomainModalOpen(false)} />
      <TemplateLibraryModal isOpen={isTemplateLibraryOpen} onClose={() => setIsTemplateLibraryOpen(false)} templates={templates} />
    </div>
  );
}
