"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";
import capacityStyles from "./CapacityPanel.module.css";

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

const statusClass = (tone: "healthy" | "warning" | "critical") =>
  `${capacityStyles.statusPill} ${capacityStyles[tone]}`;

const breakerTone = (state: string): "healthy" | "warning" | "critical" => {
  if (state === "OPEN") return "critical";
  if (state === "HALF_OPEN") return "warning";
  return "healthy";
};

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
    return <div className={capacityStyles.loading}>Loading capacity and spend telemetry…</div>;
  }

  return (
    <div className={capacityStyles.root}>
      {error && <div role="alert" className={`${capacityStyles.banner} ${capacityStyles.error}`}>⚠️ {error}</div>}
      {notice && <div className={`${capacityStyles.banner} ${capacityStyles.notice}`}>✅ {notice}</div>}

      {/* Plane partition */}
      <section className={styles.attentionTablePanel}>
        <div className={styles.attentionPanelHeading}>
          <div>
            <h3>Plane partition</h3>
            <p>Transactional never waits behind bulk. The floor is never borrowable.</p>
          </div>
          {planes && (
            <span className={statusClass(planes.partitionHolding ? "healthy" : "critical")}>
              {planes.partitionHolding ? "Partition holding" : "Partition NOT holding"}
            </span>
          )}
        </div>
        {planes ? (
          <>
            {planes.alert && <div className={`${capacityStyles.banner} ${capacityStyles.error}`}>⚠️ {planes.alert}</div>}
            <div className={capacityStyles.planeGrid}>
              <PlaneCard title="Transactional" tone="transactional" reading={planes.planes.TRANSACTIONAL} />
              <PlaneCard title="Bulk" tone="bulk" reading={planes.planes.BULK} />
            </div>
          </>
        ) : (
          <p className={capacityStyles.empty}>No plane budget is configured for this tenant yet.</p>
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
          <p className={capacityStyles.empty}>
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
          {spend && <span className={statusClass(breakerTone(spend.state))}>Breaker {spend.state}</span>}
        </div>
        {spend && (
          <div className={capacityStyles.statGrid}>
            <MiniStat label="Spent today" value={`$${(spend.spentMinorUnits / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`} />
            <MiniStat label="Daily cap" value={spend.capMinorUnits === null ? "No cap" : `$${(spend.capMinorUnits / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`} />
            <MiniStat label="Utilisation" value={`${spend.utilisationPct}%`} danger={spend.utilisationPct >= 80} />
          </div>
        )}
        <div className={capacityStyles.capForm}>
          <label className={capacityStyles.field}>
            Daily cap (USD, blank = no cap)
            <input
              value={capInput}
              onChange={(e) => setCapInput(e.target.value)}
              placeholder="e.g. 500.00"
              inputMode="decimal"
              className={capacityStyles.input}
            />
          </label>
          <button
            type="button"
            onClick={saveCap}
            disabled={savingCap}
            className={`${styles.btnPillDark} ${capacityStyles.updateButton}`}
          >
            {savingCap ? "Saving…" : "Update cap"}
          </button>
        </div>
      </section>
    </div>
  );
}

function PlaneCard({ title, tone, reading }: { title: string; tone: "transactional" | "bulk"; reading: PlaneReading }) {
  const usedPct = reading.capacityPerMinute > 0 ? Math.min(100, Math.round((reading.consumedThisMinute / reading.capacityPerMinute) * 100)) : 0;
  const titleClass = tone === "bulk" ? `${capacityStyles.planeTitle} ${capacityStyles.planeTitleBulk}` : capacityStyles.planeTitle;
  return (
    <div className={capacityStyles.planeCard}>
      <div className={capacityStyles.planeHead}>
        <strong className={titleClass}>{title}</strong>
        <span className={capacityStyles.planeMeta}>{reading.consumedThisMinute}/{reading.capacityPerMinute} per min</span>
      </div>
      <meter className={`${capacityStyles.meter} ${tone === "bulk" ? capacityStyles.meterBulk : ""}`} min={0} max={100} value={usedPct} aria-label={`${title} usage ${usedPct}%`} />
      <div className={capacityStyles.planeDetail}>{reading.consumedToday.toLocaleString("en-US")} today</div>
      {reading.floorReserved !== undefined && <div className={capacityStyles.planeMeta}>Floor reserved: {reading.floorReserved}/min</div>}
      {reading.note && <div className={capacityStyles.planeNote}>{reading.note}</div>}
    </div>
  );
}

function MiniStat({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={capacityStyles.miniStat}>
      <div className={capacityStyles.statLabel}>{label}</div>
      <div className={danger ? `${capacityStyles.statValue} ${capacityStyles.statDanger}` : capacityStyles.statValue}>{value}</div>
    </div>
  );
}
