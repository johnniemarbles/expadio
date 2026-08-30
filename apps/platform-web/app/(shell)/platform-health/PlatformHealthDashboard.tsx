"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../communications/page.module.css";

type HealthStatus = "WATCH" | "DEGRADED" | "CRITICAL";

interface HealthEntry {
  readonly tenantId: string;
  readonly healthKey: string;
  readonly healthStatus: HealthStatus;
  readonly itemCount: number;
  readonly oldestAt: string | null;
  readonly newestAt: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface HealthApiResponse {
  readonly entries?: HealthEntry[];
}

interface HealthDomain {
  readonly key: string;
  readonly label: string;
  readonly endpoint: string;
  readonly detailPath: string;
  readonly description: string;
}

interface LoadedDomain extends HealthDomain {
  readonly entries: HealthEntry[];
  readonly error?: string;
}

export interface PlatformHealthDashboardProps {
  readonly queryString?: string;
}

const DOMAINS: readonly HealthDomain[] = [
  {
    key: "execution",
    label: "Execution",
    endpoint: "/api/execution/health",
    detailPath: "/execution-trace",
    description: "Governed action, schedule, communication and webhook health.",
  },
  {
    key: "communications",
    label: "Communications",
    endpoint: "/api/communications/health",
    detailPath: "/communications?tab=deliverability",
    description: "Open deliveries, terminal events, unmatched webhooks and provider evidence.",
  },
  {
    key: "scheduler",
    label: "Scheduler",
    endpoint: "/api/scheduler/health",
    detailPath: "/platform-health#scheduler",
    description: "Due targets, disabled targets, expired leases and due materialization.",
  },
  {
    key: "outbox",
    label: "Outbox",
    endpoint: "/api/outbox/health",
    detailPath: "/platform-health#outbox",
    description: "Ready backlog, retry due, future retry, stale claims and dead rows.",
  },
] as const;

function appendQuery(path: string, queryString: string | undefined): string {
  if (queryString === undefined || queryString === "") return path;
  const separator = path.includes("?") ? "&" : "?";
  const trimmed = queryString.startsWith("?") ? queryString.slice(1) : queryString;
  return `${path}${separator}${trimmed}`;
}

function statusRank(status: HealthStatus): number {
  if (status === "CRITICAL") return 3;
  if (status === "DEGRADED") return 2;
  return 1;
}

function statusLabel(status: HealthStatus): string {
  if (status === "CRITICAL") return "Critical";
  if (status === "DEGRADED") return "Degraded";
  return "Watch";
}

function formatWhen(value: string | null): string {
  if (value === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatHealthKey(value: string): string {
  return value
    .replace(/^domain_event_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function totalItems(entries: readonly HealthEntry[]): number {
  return entries.reduce((sum, entry) => sum + Number(entry.itemCount || 0), 0);
}

function worstStatus(entries: readonly HealthEntry[]): HealthStatus {
  return entries.reduce<HealthStatus>((worst, entry) => (
    statusRank(entry.healthStatus) > statusRank(worst) ? entry.healthStatus : worst
  ), "WATCH");
}

function countByStatus(domains: readonly LoadedDomain[], status: HealthStatus): number {
  return domains.reduce((sum, domain) => (
    sum + domain.entries.filter((entry) => entry.healthStatus === status && entry.itemCount > 0).length
  ), 0);
}

async function loadDomain(domain: HealthDomain, queryString: string | undefined): Promise<LoadedDomain> {
  const response = await fetch(appendQuery(domain.endpoint, queryString), { cache: "no-store" });
  if (!response.ok) {
    return {
      ...domain,
      entries: [],
      error: `HTTP ${response.status}`,
    };
  }

  const body = await response.json() as HealthApiResponse;
  return {
    ...domain,
    entries: Array.isArray(body.entries) ? body.entries : [],
  };
}

export function PlatformHealthDashboard({ queryString }: PlatformHealthDashboardProps) {
  const [domains, setDomains] = useState<LoadedDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const loaded = await Promise.all(DOMAINS.map((domain) => loadDomain(domain, queryString)));
      setDomains(loaded);
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load platform health.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // queryString is intentionally the only runtime dependency; DOMAINS is static.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  const allEntries = useMemo(() => domains.flatMap((domain) => domain.entries), [domains]);
  const activeEntries = useMemo(() => allEntries.filter((entry) => entry.itemCount > 0), [allEntries]);
  const worst = worstStatus(activeEntries);
  const totalOpen = totalItems(activeEntries);
  const criticalCount = countByStatus(domains, "CRITICAL");
  const degradedCount = countByStatus(domains, "DEGRADED");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className={styles.summaryMetricsGrid}>
        <div className={styles.summaryMetricCard}>
          <span>Overall posture</span>
          <strong>{activeEntries.length === 0 ? "Clear" : statusLabel(worst)}</strong>
          <small>{activeEntries.length} active health buckets</small>
        </div>
        <div className={styles.summaryMetricCard}>
          <span>Open operational items</span>
          <strong>{totalOpen}</strong>
          <small>Across execution, communications, scheduler and outbox</small>
        </div>
        <div className={styles.summaryMetricCard}>
          <span>Critical / degraded buckets</span>
          <strong>{criticalCount} / {degradedCount}</strong>
          <small>Sorted by severity below</small>
        </div>
      </div>

      <div className={styles.cardPanel}>
        <div className={styles.cardPanelHeader}>
          <div>
            <h3 style={{ margin: 0 }}>Health domains</h3>
            <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
              Read-only summary from governed health APIs. Recovery commands are intentionally not exposed here.
            </p>
          </div>
          <button className={styles.btnExport} type="button" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {error !== null ? (
          <div style={{ padding: 12, borderRadius: 10, background: "#fef2f2", color: "#991b1b", fontSize: 13 }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          {DOMAINS.map((domain) => {
            const loaded = domains.find((entry) => entry.key === domain.key);
            const entries = loaded?.entries ?? [];
            const active = entries.filter((entry) => entry.itemCount > 0);
            const domainWorst = worstStatus(active);
            return (
              <a
                key={domain.key}
                id={domain.key}
                href={appendQuery(domain.detailPath, queryString)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 16,
                  border: "1px solid #e2e8f0",
                  borderRadius: 14,
                  textDecoration: "none",
                  color: "inherit",
                  background: "#ffffff",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <strong>{domain.label}</strong>
                  <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: active.length === 0 ? "#047857" : "#92400e" }}>
                    {loaded?.error ?? (active.length === 0 ? "Clear" : statusLabel(domainWorst))}
                  </span>
                </div>
                <span style={{ color: "#64748b", fontSize: 13, lineHeight: 1.4 }}>{domain.description}</span>
                <span style={{ fontSize: 22, fontWeight: 800 }}>{totalItems(active)}</span>
              </a>
            );
          })}
        </div>

        <div style={{ marginTop: 12 }} className={styles.dataTimestamp}>
          Last loaded: {loadedAt === null ? "—" : formatWhen(loadedAt)}
        </div>
      </div>

      <div className={styles.cardPanel}>
        <div className={styles.cardPanelHeader}>
          <div>
            <h3 style={{ margin: 0 }}>Active health buckets</h3>
            <p style={{ margin: "4px 0 0", color: "#64748b", fontSize: 13 }}>
              Empty buckets are hidden so operators can focus on work that needs attention.
            </p>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#64748b" }}>
                <th style={{ padding: "10px 8px", borderBottom: "1px solid #e2e8f0" }}>Domain</th>
                <th style={{ padding: "10px 8px", borderBottom: "1px solid #e2e8f0" }}>Bucket</th>
                <th style={{ padding: "10px 8px", borderBottom: "1px solid #e2e8f0" }}>Status</th>
                <th style={{ padding: "10px 8px", borderBottom: "1px solid #e2e8f0" }}>Count</th>
                <th style={{ padding: "10px 8px", borderBottom: "1px solid #e2e8f0" }}>Oldest</th>
                <th style={{ padding: "10px 8px", borderBottom: "1px solid #e2e8f0" }}>Newest</th>
              </tr>
            </thead>
            <tbody>
              {domains.flatMap((domain) => domain.entries
                .filter((entry) => entry.itemCount > 0)
                .sort((a, b) => statusRank(b.healthStatus) - statusRank(a.healthStatus))
                .map((entry) => (
                  <tr key={`${domain.key}:${entry.healthKey}`}>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9", fontWeight: 700 }}>{domain.label}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9" }}>{formatHealthKey(entry.healthKey)}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9" }}>{statusLabel(entry.healthStatus)}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9", fontWeight: 800 }}>{entry.itemCount}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9" }}>{formatWhen(entry.oldestAt)}</td>
                    <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9" }}>{formatWhen(entry.newestAt)}</td>
                  </tr>
                ))) }
              {!loading && activeEntries.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 18, textAlign: "center", color: "#64748b" }}>
                    No active health buckets reported by the platform health APIs.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
