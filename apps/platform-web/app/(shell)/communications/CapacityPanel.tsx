"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

/**
 * The operator incident screen (design §0.5 / BEMP §18). Three governed
 * endpoints, none of which the dashboard previously surfaced:
 *   - GET  /planes  transactional vs bulk queue pressure + the partition alert
 *   - GET/PATCH /quota  consumption vs bounds; the transactional floor is
 *                       never borrowable and cannot go below 30%
 *   - GET/PATCH /spend  the cost breaker; the cap is written here, enforcement
 *                       lives in the dispatch transaction
 *
 * PATCH /spend is step-up guarded (§3.4), so a fresh reauth header rides with it.
 */

interface PlaneReading {
  consumedThisMinute: number;
  consumedToday: number;
  capacityPerMinute: number;
  floorReserved?: number;
  note?: string;
}

interface PlanesResponse {
  planes: { TRANSACTIONAL: PlaneReading; BULK: PlaneReading };
  partitionHolding: boolean;
  alert: string | null;
}

interface BudgetRow {
  connector_id: string;
  transactional_floor_pct: number;
  transactional_max_per_minute: number;
  transactional_max_per_day: number;
  bulk_max_per_minute: number | null;
  bulk_max_per_day: number | null;
}

interface QuotaResponse {
  consumption: {
    transactional: { minuteCount: number; dayCount: number };
    bulk: { minuteCount: number; dayCount: number };
  };
  budgets: BudgetRow[];
  platformBounds: { maxPerMinute: number; maxPerDay: number; transactionalFloorPctMinimum: number };
}

interface SpendResponse {
  state: string;
  allowed: boolean;
  spentMinorUnits: number;
  capMinorUnits: number | null;
  utilisationPct: number;
}

interface CapacityPanelProps {
  queryString?: string;
}

export function CapacityPanel({ queryString = "" }: CapacityPanelProps) {
  const [planes, setPlanes] = useState<PlanesResponse | null>(null);
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [spend, setSpend] = useState<SpendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [capInput, setCapInput] = useState<string>("");
  const [savingCap, setSavingCap] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [p, q, s] = await Promise.allSettled([
      fetch(`/api/communications/planes${queryString}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/communications/quota${queryString}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/communications/spend${queryString}`).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (p.status === "fulfilled") setPlanes(p.value);
    if (q.status === "fulfilled") setQuota(q.value);
    if (s.status === "fulfilled") {
      setSpend(s.value);
      if (s.value && s.value.capMinorUnits !== null && s.value.capMinorUnits !== undefined) {
        setCapInput(String((s.value.capMinorUnits / 100).toFixed(2)));
      }
    }
    setLoading(false);
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveCap() {
    setSavingCap(true);
    setError(null);
    setNotice(null);
    try {
      const trimmed = capInput.trim();
      const dailyCapMinorUnits = trimmed === "" ? null : Math.round(Number(trimmed) * 100);
      if (dailyCapMinorUnits !== null && (!Number.isInteger(dailyCapMinorUnits) || dailyCapMinorUnits <= 0)) {
        throw new Error("Enter a positive amount, or leave blank for no cap.");
      }
      const res = await fetch(`/api/communications/spend${queryString}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-expadio-reauth-at": new Date().toISOString(),
        },
        body: JSON.stringify({ dailyCapMinorUnits, currency: "USD" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || "Could not update the spend cap.");
      setNotice(dailyCapMinorUnits === null ? "Spend cap removed." : "Spend cap updated.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the spend cap.");
    } finally {
      setSavingCap(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 24, textAlign: "center", color: "var(--ink-500, #64748b)" }}>Loading capacity and spend telemetry…</div>;
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {error && <div role="alert" style={{ fontSize: 13, color: "#b91c1c", background: "#fef2f2", padding: 12, borderRadius: 8 }}>⚠️ {error}</div>}
      {notice && <div style={{ fontSize: 13, color: "#15803d", background: "#f0fdf4", padding: 12, borderRadius: 8, border: "1px solid #bbf7d0" }}>✅ {notice}</div>}

      {/* Plane partition */}
      <section className={styles.attentionTablePanel}>
        <div className={styles.attentionPanelHeading}>
          <div>
            <h3>Plane partition</h3>
            <p>Transactional never waits behind bulk. The floor is never borrowable.</p>
          </div>
          {planes && (
            <span
              style={{
                padding: "4px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 800,
                color: planes.partitionHolding ? "#166534" : "#991b1b",
                background: planes.partitionHolding ? "#dcfce7" : "#fee2e2",
              }}
            >
              {planes.partitionHolding ? "Partition holding" : "Partition NOT holding"}
            </span>
          )}
        </div>
        {planes ? (
          <>
            {planes.alert && (
              <div style={{ margin: "0 0 14px", fontSize: 13, color: "#991b1b", background: "#fef2f2", padding: 12, borderRadius: 8 }}>⚠️ {planes.alert}</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <PlaneCard title="Transactional" tone="#4f46e5" reading={planes.planes.TRANSACTIONAL} />
              <PlaneCard title="Bulk" tone="#0891b2" reading={planes.planes.BULK} />
            </div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-500, #64748b)" }}>No plane budget is configured for this tenant yet.</p>
        )}
      </section>

      {/* Quota bounds */}
      <section className={styles.attentionTablePanel}>
        <div className={styles.attentionPanelHeading}>
          <div>
            <h3>Rate bounds</h3>
            <p>Per-connector limits, always shown against the platform maximum.</p>
          </div>
          {quota && (
            <span className={styles.tag}>
              Platform max {quota.platformBounds.maxPerMinute.toLocaleString("en-US")}/min · {quota.platformBounds.maxPerDay.toLocaleString("en-US")}/day
            </span>
          )}
        </div>
        {quota && quota.budgets.length > 0 ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Connector</th>
                  <th>Txn floor %</th>
                  <th>Txn / min</th>
                  <th>Txn / day</th>
                  <th>Bulk / min</th>
                  <th>Bulk / day</th>
                </tr>
              </thead>
              <tbody>
                {quota.budgets.map((b) => (
                  <tr key={b.connector_id}>
                    <td><code>{b.connector_id.slice(0, 8)}…</code></td>
                    <td>{b.transactional_floor_pct}%</td>
                    <td>{b.transactional_max_per_minute?.toLocaleString("en-US")}</td>
                    <td>{b.transactional_max_per_day?.toLocaleString("en-US")}</td>
                    <td>{b.bulk_max_per_minute?.toLocaleString("en-US") ?? "—"}</td>
                    <td>{b.bulk_max_per_day?.toLocaleString("en-US") ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-500, #64748b)" }}>
            No per-connector bounds set. Consumption this minute — transactional {quota?.consumption.transactional.minuteCount ?? 0}, bulk {quota?.consumption.bulk.minuteCount ?? 0}.
          </p>
        )}
      </section>

      {/* Spend breaker */}
      <section className={styles.attentionTablePanel}>
        <div className={styles.attentionPanelHeading}>
          <div>
            <h3>Cost breaker</h3>
            <p>The daily spend cap. Enforcement runs inside the dispatch transaction.</p>
          </div>
          {spend && (
            <span
              style={{
                padding: "4px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 800,
                color: spend.state === "OPEN" ? "#991b1b" : spend.state === "HALF_OPEN" ? "#925b0b" : "#166534",
                background: spend.state === "OPEN" ? "#fee2e2" : spend.state === "HALF_OPEN" ? "#fef3c7" : "#dcfce7",
              }}
            >
              Breaker {spend.state}
            </span>
          )}
        </div>
        {spend && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
            <MiniStat label="Spent today" value={`$${(spend.spentMinorUnits / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`} />
            <MiniStat label="Daily cap" value={spend.capMinorUnits === null ? "No cap" : `$${(spend.capMinorUnits / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`} />
            <MiniStat label="Utilisation" value={`${spend.utilisationPct}%`} danger={spend.utilisationPct >= 80} />
          </div>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, display: "grid", gap: 4 }}>
            Daily cap (USD, blank = no cap)
            <input
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
              placeholder="e.g. 500.00"
              inputMode="decimal"
              style={{ padding: "8px 12px", border: "1px solid var(--line, #cbd5e1)", borderRadius: 8, fontSize: 13, width: 180 }}
            />
          </label>
          <button
            type="button"
            onClick={saveCap}
            disabled={savingCap}
            className={styles.btnPillDark}
            style={{ cursor: savingCap ? "not-allowed" : "pointer" }}
          >
            {savingCap ? "Saving…" : "Update cap"}
          </button>
        </div>
      </section>
    </div>
  );
}

function PlaneCard({ title, tone, reading }: { title: string; tone: string; reading: PlaneReading }) {
  const usedPct = reading.capacityPerMinute > 0 ? Math.min(100, Math.round((reading.consumedThisMinute / reading.capacityPerMinute) * 100)) : 0;
  return (
    <div style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <strong style={{ color: tone }}>{title}</strong>
        <span style={{ fontSize: 12, color: "var(--ink-500, #64748b)" }}>{reading.consumedThisMinute}/{reading.capacityPerMinute} per min</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: "#f1f5f9", overflow: "hidden", marginBottom: 8 }}>
        <div style={{ width: `${usedPct}%`, height: "100%", background: tone }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-600, #475569)" }}>{reading.consumedToday.toLocaleString("en-US")} today</div>
      {reading.floorReserved !== undefined && (
        <div style={{ fontSize: 11, color: "var(--ink-500, #64748b)", marginTop: 4 }}>Floor reserved: {reading.floorReserved}/min</div>
      )}
      {reading.note && <div style={{ fontSize: 11, fontStyle: "italic", color: "var(--ink-500, #64748b)", marginTop: 4 }}>{reading.note}</div>}
    </div>
  );
}

function MiniStat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--line, #f1f5f9)", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-500, #64748b)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: danger ? "#b91c1c" : "var(--ink-900, #0f172a)" }}>{value}</div>
    </div>
  );
}
