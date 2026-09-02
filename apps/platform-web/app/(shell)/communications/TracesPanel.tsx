"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";
import type { DecisionTrace, TraceOutcome } from "@expadio/communication";

/**
 * The decision-trace explorer (design §7). Every refusal, throttle and
 * suppression is explainable gate by gate. Backed by:
 *   - GET /traces            filterable list (outcome, message id, reason code)
 *   - GET /traces/[traceId]  the full gate-by-gate record, recipient-redacted
 *
 * Filters sync nowhere but state here; the API already deep-links by query
 * param, so this panel is the human entry point the spec calls for.
 */

const OUTCOMES: TraceOutcome[] = ["SENT", "QUEUED", "REFUSED", "THROTTLED", "SUPPRESSED", "CANCELLED", "FAILED"];

const OUTCOME_TONE: Record<string, { fg: string; bg: string }> = {
  SENT: { fg: "var(--theme-success)", bg: "color-mix(in srgb,var(--theme-success) 12%,transparent)" },
  QUEUED: { fg: "#3730a3", bg: "#e0e7ff" },
  REFUSED: { fg: "var(--theme-danger)", bg: "color-mix(in srgb,var(--theme-danger) 12%,transparent)" },
  THROTTLED: { fg: "var(--theme-warning)", bg: "color-mix(in srgb,var(--theme-warning) 12%,transparent)" },
  SUPPRESSED: { fg: "var(--theme-warning)", bg: "color-mix(in srgb,var(--theme-warning) 12%,transparent)" },
  CANCELLED: { fg: "var(--theme-text-secondary)", bg: "var(--theme-surface-muted)" },
  FAILED: { fg: "var(--theme-danger)", bg: "color-mix(in srgb,var(--theme-danger) 12%,transparent)" },
};

const VERDICT_TONE: Record<string, string> = {
  PASS: "var(--theme-success)",
  FAIL: "var(--theme-danger)",
  NOT_EVALUATED: "var(--theme-neutral)",
};

interface TracesPanelProps {
  queryString?: string;
}

export function TracesPanel({ queryString = "" }: TracesPanelProps) {
  const [traces, setTraces] = useState<DecisionTrace[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<string>("");
  const [messageId, setMessageId] = useState<string>("");
  const [reasonCode, setReasonCode] = useState<string>("");

  const [selected, setSelected] = useState<DecisionTrace | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(queryString.startsWith("?") ? queryString.slice(1) : queryString);
      if (outcome) params.set("outcome", outcome);
      if (messageId.trim()) params.set("messageId", messageId.trim());
      if (reasonCode.trim()) params.set("reasonCode", reasonCode.trim());
      params.set("limit", "25");
      const res = await fetch(`/api/communications/traces?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || "Could not load traces.");
      setTraces(data.traces ?? []);
      setTotal(data.total ?? 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load traces.");
      setTraces([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString, outcome, messageId, reasonCode]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  async function openTrace(traceId: string) {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/communications/traces/${encodeURIComponent(traceId)}${queryString}`);
      const data = await res.json();
      if (res.ok) setSelected(data);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <section className={styles.attentionTablePanel}>
      <div className={styles.attentionPanelHeading}>
        <div>
          <h3>Decision traces</h3>
          <p>Every send, refusal, throttle and suppression, explainable gate by gate.</p>
        </div>
        <span className={styles.tag}>{total} records</span>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <label style={{ fontSize: 12, display: "grid", gap: 4 }}>
          Outcome
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--theme-border)", fontSize: 13 }}>
            <option value="">All outcomes</option>
            {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12, display: "grid", gap: 4 }}>
          Message id
          <input value={messageId} onChange={(e) => setMessageId(e.target.value)} placeholder="uuid" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--theme-border)", fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 12, display: "grid", gap: 4 }}>
          Reason code
          <input value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} placeholder="e.g. SUPPRESSED_HARD_BOUNCE" style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--theme-border)", fontSize: 13 }} />
        </label>
        <button type="button" onClick={() => void load()} className={styles.btnPillDark} style={{ cursor: "pointer" }}>Apply filters</button>
      </div>

      {error && <div role="alert" style={{ fontSize: 13, color: "var(--theme-danger)", background: "color-mix(in srgb,var(--theme-danger) 10%,transparent)", padding: 10, borderRadius: 8, marginBottom: 12 }}>⚠️ {error}</div>}

      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--theme-text-muted)" }}>Loading decision traces…</div>
      ) : traces.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Trace</th>
                <th>Kind</th>
                <th>Outcome</th>
                <th>Reason</th>
                <th>Stopped at gate</th>
                <th>When</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {traces.map((t) => {
                const tone = OUTCOME_TONE[t.outcome] ?? OUTCOME_TONE.CANCELLED;
                return (
                  <tr key={t.traceId}>
                    <td><code>{t.traceId.slice(0, 8)}…</code></td>
                    <td>{t.kind}</td>
                    <td><span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: tone.fg, background: tone.bg }}>{t.outcome}</span></td>
                    <td>{t.reasonCode ?? "—"}</td>
                    <td>{t.stoppedAtGate ?? "—"}</td>
                    <td>{new Date(t.createdAt).toLocaleString()}</td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" onClick={() => openTrace(t.traceId)} style={{ fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>Inspect</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ padding: 20, textAlign: "center", color: "var(--theme-text-muted)" }}>
          No decision traces match these filters. Traces appear as messages are evaluated across live connectors.
        </div>
      )}

      {(selected || detailLoading) && (
        <div role="presentation" onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(15,23,42,.6)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "var(--theme-surface-raised)", border: "1px solid var(--theme-border)", borderRadius: 16, padding: 28 }}>
            {detailLoading && !selected ? (
              <div style={{ padding: 30, textAlign: "center", color: "var(--theme-text-muted)" }}>Loading trace…</div>
            ) : selected ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                  <div>
                    <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 800, color: "var(--theme-primary)" }}>Decision trace</span>
                    <h2 style={{ margin: "4px 0 0", fontSize: 18, fontFamily: "monospace" }}>{selected.traceId}</h2>
                    <div style={{ fontSize: 12, color: "var(--theme-text-muted)" }}>
                      {selected.kind} · {selected.outcome}{selected.reasonCode ? ` · ${selected.reasonCode}` : ""} · corr {selected.correlationId.slice(0, 8)}…
                    </div>
                  </div>
                  <button type="button" onClick={() => setSelected(null)} aria-label="Close" style={{ border: "1px solid var(--theme-border)", background: "transparent", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>✕</button>
                </div>

                <h4 style={{ margin: "0 0 8px", fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--theme-text-muted)" }}>Enforcement gates</h4>
                <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                  {selected.gates.map((g) => (
                    <div key={`${g.gate}-${g.ordinal}`} style={{ border: "1px solid var(--line, var(--theme-surface-muted))", borderRadius: 8, padding: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ fontSize: 13 }}>{g.ordinal}. {g.gate}</strong>
                        <span style={{ fontSize: 11, fontWeight: 800, color: VERDICT_TONE[g.verdict] ?? "var(--theme-neutral)" }}>{g.verdict} · {g.elapsedMs}ms</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--theme-text-secondary)", marginTop: 4 }}>{g.detail}</div>
                      {g.remediation && (
                        <div style={{ fontSize: 12, color: "var(--theme-warning)", marginTop: 6 }}>
                          → {g.remediation}
                          {g.remediationHref && <a href={g.remediationHref} style={{ marginLeft: 6, color: "var(--theme-primary)" }}>Fix</a>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Connectors considered</div>
                    {selected.connectorsConsidered.length > 0
                      ? selected.connectorsConsidered.map((c) => <div key={c} style={{ fontFamily: "monospace" }}>{c}</div>)
                      : <div style={{ color: "var(--theme-text-muted)" }}>none</div>}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Connectors rejected</div>
                    {Object.keys(selected.connectorsRejected).length > 0
                      ? Object.entries(selected.connectorsRejected).map(([c, reasons]) => (
                          <div key={c} style={{ marginBottom: 4 }}>
                            <span style={{ fontFamily: "monospace" }}>{c}</span>: {reasons.join(", ")}
                          </div>
                        ))
                      : <div style={{ color: "var(--theme-text-muted)" }}>none</div>}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
