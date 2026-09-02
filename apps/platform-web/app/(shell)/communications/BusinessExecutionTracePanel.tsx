"use client";

import { useState } from "react";
import styles from "./page.module.css";

type TraceKind =
  | "DOMAIN_EVENT"
  | "DOMAIN_EVENT_OUTBOX"
  | "GOVERNED_ACTION"
  | "GOVERNED_ACTION_ATTEMPT"
  | "SCHEDULED_ACTION"
  | "COMMUNICATION_DELIVERY"
  | "COMMUNICATION_PROVIDER_ATTEMPT"
  | "OPERATIONAL_TASK";

interface BusinessExecutionTraceEntry {
  readonly traceKind: TraceKind;
  readonly traceId: string;
  readonly parentTraceId: string | null;
  readonly tenantId: string;
  readonly rootEventId: string;
  readonly correlationId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly sourceEventType: string | null;
  readonly actionIntentId: string | null;
  readonly executorClass: string | null;
  readonly actionKey: string | null;
  readonly state: string | null;
  readonly reasonCode: string | null;
  readonly occurredAt: string;
  readonly summary: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface TraceApiResponse {
  readonly entries?: BusinessExecutionTraceEntry[];
  readonly error?: string;
  readonly message?: string;
}

interface BusinessExecutionTracePanelProps {
  queryString?: string;
}

const KIND_TONE: Record<string, { fg: string; bg: string }> = {
  DOMAIN_EVENT: { fg: "#1d4ed8", bg: "#dbeafe" },
  DOMAIN_EVENT_OUTBOX: { fg: "#3730a3", bg: "#e0e7ff" },
  GOVERNED_ACTION: { fg: "#7c2d12", bg: "#ffedd5" },
  GOVERNED_ACTION_ATTEMPT: { fg: "#854d0e", bg: "color-mix(in srgb,var(--theme-warning) 12%,transparent)" },
  SCHEDULED_ACTION: { fg: "#6d28d9", bg: "#ede9fe" },
  COMMUNICATION_DELIVERY: { fg: "var(--theme-success)", bg: "color-mix(in srgb,var(--theme-success) 12%,transparent)" },
  COMMUNICATION_PROVIDER_ATTEMPT: { fg: "var(--theme-primary)", bg: "color-mix(in srgb,var(--theme-primary) 12%,transparent)" },
  OPERATIONAL_TASK: { fg: "#334155", bg: "var(--theme-surface-muted)" },
};

function appendQuery(base: string, queryString: string): string {
  if (!queryString) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${queryString.startsWith("?") ? queryString.slice(1) : queryString}`;
}

function shortId(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length <= 14 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function compactMetadata(metadata: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(metadata);
  if (keys.length === 0) return "{}";
  return keys.slice(0, 4).join(", ") + (keys.length > 4 ? ` +${keys.length - 4}` : "");
}

export function BusinessExecutionTracePanel({ queryString = "" }: BusinessExecutionTracePanelProps) {
  const [eventId, setEventId] = useState("");
  const [correlationId, setCorrelationId] = useState("");
  const [aggregateType, setAggregateType] = useState("");
  const [aggregateId, setAggregateId] = useState("");
  const [entries, setEntries] = useState<BusinessExecutionTraceEntry[]>([]);
  const [selected, setSelected] = useState<BusinessExecutionTraceEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadTrace() {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const params = new URLSearchParams();
      if (eventId.trim()) params.set("eventId", eventId.trim());
      if (correlationId.trim()) params.set("correlationId", correlationId.trim());
      if (aggregateType.trim()) params.set("aggregateType", aggregateType.trim());
      if (aggregateId.trim()) params.set("aggregateId", aggregateId.trim());
      params.set("limit", "200");

      const url = appendQuery(`/api/execution/trace?${params.toString()}`, queryString);
      const response = await fetch(url);
      const data = (await response.json().catch(() => ({}))) as TraceApiResponse;
      if (!response.ok) throw new Error(data.error || data.message || "Could not load execution trace.");
      setEntries(data.entries ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load execution trace.");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  const canLoad = eventId.trim() !== ""
    || correlationId.trim() !== ""
    || (aggregateType.trim() !== "" && aggregateId.trim() !== "");

  return (
    <section className={styles.attentionTablePanel}>
      <div className={styles.attentionPanelHeading}>
        <div>
          <h3>Business execution trace</h3>
          <p>Follow one business event across outbox, governed actions, schedules, deliveries, provider attempts, webhooks and tasks.</p>
        </div>
        <span className={styles.tag}>{entries.length} steps</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 12, display: "grid", gap: 4 }}>
          Root event id
          <input value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="uuid" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 12, display: "grid", gap: 4 }}>
          Correlation id
          <input value={correlationId} onChange={(e) => setCorrelationId(e.target.value)} placeholder="correlation" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 12, display: "grid", gap: 4 }}>
          Aggregate type
          <input value={aggregateType} onChange={(e) => setAggregateType(e.target.value)} placeholder="Treatment" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 12, display: "grid", gap: 4 }}>
          Aggregate id
          <input value={aggregateId} onChange={(e) => setAggregateId(e.target.value)} placeholder="business id" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", fontSize: 13 }} />
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <button type="button" onClick={() => void loadTrace()} disabled={!canLoad || loading} className={styles.btnPillDark} style={{ cursor: canLoad && !loading ? "pointer" : "not-allowed", opacity: canLoad ? 1 : 0.55 }}>
          {loading ? "Loading…" : "Load execution trace"}
        </button>
        <span style={{ fontSize: 12, color: "var(--ink-500, #64748b)" }}>
          Use event id, correlation id, or aggregate type + aggregate id. Results are tenant-scoped by the API.
        </span>
      </div>

      {error && <div role="alert" style={{ fontSize: 13, color: "var(--theme-danger)", background: "color-mix(in srgb,var(--theme-danger) 10%,transparent)", padding: 10, borderRadius: 8, marginBottom: 12 }}>⚠️ {error}</div>}

      {entries.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>State</th>
                <th>Action</th>
                <th>Reason</th>
                <th>Trace</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const tone = KIND_TONE[entry.traceKind] ?? KIND_TONE.OPERATIONAL_TASK;
                return (
                  <tr key={`${entry.traceKind}:${entry.traceId}`}>
                    <td>{formatWhen(entry.occurredAt)}</td>
                    <td><span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: tone.fg, background: tone.bg }}>{entry.traceKind}</span></td>
                    <td>{entry.state ?? "—"}</td>
                    <td>{entry.actionKey ?? entry.executorClass ?? entry.sourceEventType ?? "—"}</td>
                    <td>{entry.reasonCode ?? "—"}</td>
                    <td><code>{shortId(entry.traceId)}</code></td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" onClick={() => setSelected(entry)} style={{ fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>Inspect</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : !loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "var(--ink-500, #64748b)" }}>
          Enter a bounded business filter to load a trace. This panel reads `GET /api/execution/trace` and does not mutate execution state.
        </div>
      ) : null}

      {selected && (
        <div role="presentation" onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(15,23,42,.6)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(860px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "var(--surface, var(--theme-text-inverse))", border: "1px solid var(--line, #e2e8f0)", borderRadius: 16, padding: 28 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 800, color: "var(--brand, var(--theme-primary))" }}>Execution trace step</span>
                <h2 style={{ margin: "4px 0 0", fontSize: 18, fontFamily: "monospace" }}>{selected.traceId}</h2>
                <div style={{ fontSize: 12, color: "var(--ink-500, #64748b)" }}>
                  {selected.traceKind} · root {shortId(selected.rootEventId)} · corr {shortId(selected.correlationId)}
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close" style={{ border: "1px solid var(--line, #e2e8f0)", background: "transparent", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, fontSize: 12, marginBottom: 16 }}>
              <div><strong>Parent</strong><br /><code>{selected.parentTraceId ?? "—"}</code></div>
              <div><strong>Aggregate</strong><br />{selected.aggregateType} · <code>{selected.aggregateId}</code></div>
              <div><strong>State</strong><br />{selected.state ?? "—"}</div>
              <div><strong>Reason</strong><br />{selected.reasonCode ?? "—"}</div>
              <div><strong>Executor</strong><br />{selected.executorClass ?? "—"}</div>
              <div><strong>Action</strong><br />{selected.actionKey ?? "—"}</div>
            </div>

            <div style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <strong style={{ fontSize: 13 }}>Summary</strong>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--ink-600, #475569)" }}>{selected.summary}</p>
            </div>

            <div>
              <strong style={{ fontSize: 13 }}>Metadata</strong>
              <div style={{ fontSize: 12, color: "var(--ink-500, #64748b)", margin: "4px 0 8px" }}>{compactMetadata(selected.metadata)}</div>
              <pre style={{ overflowX: "auto", background: "var(--theme-text-primary)", color: "#e2e8f0", padding: 14, borderRadius: 12, fontSize: 12, lineHeight: 1.5 }}>{JSON.stringify(selected.metadata, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
