"use client";

import { useCallback, useEffect, useState } from "react";
import { MotionPanel, MotionCard } from '@expadio/ui';
import styles from "./page.module.css";
import traceStyles from "./TracesPanel.module.css";
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

interface TracesPanelProps {
  queryString?: string;
}

function outcomeClass(outcome: TraceOutcome) {
  switch (outcome) {
    case "SENT":
      return `${traceStyles.outcomePill} ${traceStyles.outcomeSent}`;
    case "QUEUED":
      return `${traceStyles.outcomePill} ${traceStyles.outcomeQueued}`;
    case "REFUSED":
      return `${traceStyles.outcomePill} ${traceStyles.outcomeRefused}`;
    case "THROTTLED":
      return `${traceStyles.outcomePill} ${traceStyles.outcomeThrottled}`;
    case "SUPPRESSED":
      return `${traceStyles.outcomePill} ${traceStyles.outcomeSuppressed}`;
    case "FAILED":
      return `${traceStyles.outcomePill} ${traceStyles.outcomeFailed}`;
    case "CANCELLED":
    default:
      return `${traceStyles.outcomePill} ${traceStyles.outcomeCancelled}`;
  }
}

function verdictClass(verdict: string) {
  switch (verdict) {
    case "PASS":
      return `${traceStyles.verdict} ${traceStyles.verdictPass}`;
    case "FAIL":
      return `${traceStyles.verdict} ${traceStyles.verdictFail}`;
    default:
      return `${traceStyles.verdict} ${traceStyles.verdictNeutral}`;
  }
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
    <MotionPanel className={styles.attentionTablePanel}>
      <div className={styles.attentionPanelHeading}>
        <div>
          <h3>Decision traces</h3>
          <p>Every send, refusal, throttle and suppression, explainable gate by gate.</p>
        </div>
        <span className={styles.tag}>{total} records</span>
      </div>

      <div className={traceStyles.filters}>
        <label className={traceStyles.field}>
          Outcome
          <select className={traceStyles.control} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">All outcomes</option>
            {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className={traceStyles.field}>
          Message id
          <input className={traceStyles.control} value={messageId} onChange={(e) => setMessageId(e.target.value)} placeholder="uuid" />
        </label>
        <label className={traceStyles.field}>
          Reason code
          <input className={traceStyles.control} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} placeholder="e.g. SUPPRESSED_HARD_BOUNCE" />
        </label>
        <button type="button" onClick={() => void load()} className={`${styles.btnPillDark} ${traceStyles.filterButton}`}>Apply filters</button>
      </div>

      {error && <div role="alert" className={traceStyles.alert}>⚠️ {error}</div>}

      {loading ? (
        <div className={traceStyles.loading}>Loading decision traces…</div>
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
              {traces.map((t) => (
                <tr key={t.traceId}>
                  <td><code>{t.traceId.slice(0, 8)}…</code></td>
                  <td>{t.kind}</td>
                  <td><span className={outcomeClass(t.outcome)}>{t.outcome}</span></td>
                  <td>{t.reasonCode ?? "—"}</td>
                  <td>{t.stoppedAtGate ?? "—"}</td>
                  <td>{new Date(t.createdAt).toLocaleString()}</td>
                  <td className={traceStyles.actionsCell}>
                    <button type="button" onClick={() => openTrace(t.traceId)} className={traceStyles.inspectButton}>Inspect</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={traceStyles.empty}>
          No decision traces match these filters. Traces appear as messages are evaluated across live connectors.
        </div>
      )}

      {(selected || detailLoading) && (
        <div role="presentation" onClick={() => setSelected(null)} className={traceStyles.backdrop}>
          <div onClick={(e) => e.stopPropagation()} className={traceStyles.dialog}>
            {detailLoading && !selected ? (
              <div className={traceStyles.loading}>Loading trace…</div>
            ) : selected ? (
              <>
                <div className={traceStyles.detailHeader}>
                  <div>
                    <span className={traceStyles.eyebrow}>Decision trace</span>
                    <h2 className={traceStyles.traceTitle}>{selected.traceId}</h2>
                    <div className={traceStyles.traceMeta}>
                      {selected.kind} · {selected.outcome}{selected.reasonCode ? ` · ${selected.reasonCode}` : ""} · corr {selected.correlationId.slice(0, 8)}…
                    </div>
                  </div>
                  <button type="button" onClick={() => setSelected(null)} aria-label="Close" className={traceStyles.closeButton}>✕</button>
                </div>

                <h4 className={traceStyles.sectionLabel}>Enforcement gates</h4>
                <div className={traceStyles.gateList}>
                  {selected.gates.map((g) => (
                    <div key={`${g.gate}-${g.ordinal}`} className={traceStyles.gateCard}>
                      <div className={traceStyles.gateHeader}>
                        <strong className={traceStyles.gateName}>{g.ordinal}. {g.gate}</strong>
                        <span className={verdictClass(g.verdict)}>{g.verdict} · {g.elapsedMs}ms</span>
                      </div>
                      <div className={traceStyles.gateDetail}>{g.detail}</div>
                      {g.remediation && (
                        <div className={traceStyles.remediation}>
                          → {g.remediation}
                          {g.remediationHref && <a href={g.remediationHref} className={traceStyles.remediationLink}>Fix</a>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className={traceStyles.connectorGrid}>
                  <div>
                    <div className={traceStyles.connectorHeading}>Connectors considered</div>
                    {selected.connectorsConsidered.length > 0
                      ? selected.connectorsConsidered.map((c) => <div key={c} className={traceStyles.mono}>{c}</div>)
                      : <div className={traceStyles.muted}>none</div>}
                  </div>
                  <div>
                    <div className={traceStyles.connectorHeading}>Connectors rejected</div>
                    {Object.keys(selected.connectorsRejected).length > 0
                      ? Object.entries(selected.connectorsRejected).map(([c, reasons]) => (
                          <div key={c} className={traceStyles.rejectedConnector}>
                            <span className={traceStyles.mono}>{c}</span>: {reasons.join(", ")}
                          </div>
                        ))
                      : <div className={traceStyles.muted}>none</div>}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </MotionPanel>
  );
}
