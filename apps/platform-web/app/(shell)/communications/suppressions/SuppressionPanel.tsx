"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SuppressionListItem } from "../../../api/communications/suppressions/route";
import { apiError } from "../../../../lib/api-error";
import styles from "./page.module.css";

const CHANNELS = ["email", "sms", "whatsapp", "voice", "push", "rcs"] as const;
const REASONS = ["BOUNCE", "COMPLAINT", "OPT_OUT", "LEGAL_HOLD", "UNSUBSCRIBE"] as const;

export function SuppressionPanel() {
  const [items, setItems] = useState<SuppressionListItem[]>([]);
  const [status, setStatus] = useState("ACTIVE");
  const [channelFilter, setChannelFilter] = useState("");
  const [recipientKey, setRecipientKey] = useState("");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("email");
  const [reason, setReason] = useState<(typeof REASONS)[number]>("UNSUBSCRIBE");
  const [validUntil, setValidUntil] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inheritedQuery = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    const params = new URLSearchParams(window.location.search);
    params.delete("status");
    params.delete("channel");
    return params;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(inheritedQuery);
      params.set("status", status);
      if (channelFilter) params.set("channel", channelFilter);
      const response = await fetch(`/api/communications/suppressions?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(apiError(data, "Could not load suppressions."));
      if (!Array.isArray(data)) throw new Error("Suppression API returned an invalid response.");
      setItems(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load suppressions.");
    } finally {
      setLoading(false);
    }
  }, [channelFilter, inheritedQuery, status]);

  useEffect(() => { void load(); }, [load]);

  async function addSuppression(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipientKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const params = new URLSearchParams(inheritedQuery);
      const response = await fetch(`/api/communications/suppressions?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientKey: recipientKey.trim(),
          channel,
          reason,
          ...(validUntil ? { validUntil: new Date(validUntil).toISOString() } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(apiError(data, "Could not add suppression."));
      setRecipientKey("");
      setValidUntil("");
      setStatus("ACTIVE");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add suppression.");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(item: SuppressionListItem) {
    if (!confirm(`Revoke the ${item.channel} suppression for ${item.recipientKey}? Future sends may become eligible again if all other policy checks pass.`)) return;
    setBusyId(item.suppressionId);
    setError(null);
    try {
      const params = new URLSearchParams(inheritedQuery);
      const response = await fetch(`/api/communications/suppressions/${encodeURIComponent(item.suppressionId)}?${params.toString()}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(apiError(data, "Could not revoke suppression."));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke suppression.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.panel}>
      <section className={styles.card}>
        <h2>Add tenant suppression</h2>
        <p className={styles.help}>Suppressions are tenant-scoped. This surface cannot create or alter platform-global suppression policy.</p>
        <form className={styles.form} onSubmit={addSuppression}>
          <label>Recipient key
            <input value={recipientKey} onChange={(event) => setRecipientKey(event.target.value)} placeholder="email address, phone, or stable recipient key" required />
          </label>
          <label>Channel
            <select value={channel} onChange={(event) => setChannel(event.target.value as (typeof CHANNELS)[number])}>
              {CHANNELS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>Reason
            <select value={reason} onChange={(event) => setReason(event.target.value as (typeof REASONS)[number])}>
              {REASONS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>Valid until <span className={styles.optional}>(optional)</span>
            <input type="datetime-local" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
          </label>
          <button type="submit" disabled={saving || !recipientKey.trim()}>{saving ? "Adding…" : "Add suppression"}</button>
        </form>
      </section>

      <section className={styles.card}>
        <div className={styles.toolbar}>
          <div>
            <h2>Suppression register</h2>
            <p className={styles.help}>Revocation changes suppression state only; it never bypasses consent, sender, routing, quota, or other communication policy.</p>
          </div>
          <div className={styles.filters}>
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Suppression status">
              <option value="ACTIVE">Active</option>
              <option value="REVOKED">Revoked</option>
              <option value="ALL">All</option>
            </select>
            <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} aria-label="Suppression channel">
              <option value="">All channels</option>
              {CHANNELS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <button type="button" onClick={() => void load()} disabled={loading}>Refresh</button>
          </div>
        </div>

        {error && <div className={styles.error} role="alert">{error}</div>}
        {loading ? <p className={styles.help}>Loading suppressions…</p> : items.length === 0 ? <p className={styles.help}>No suppressions match the current filters.</p> : (
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Recipient</th><th>Channel</th><th>Reason</th><th>Scope</th><th>Status</th><th>Recorded</th><th>Valid until</th><th>Action</th></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.suppressionId}>
                    <td className={styles.mono}>{item.recipientKey}</td>
                    <td>{item.channel}</td>
                    <td>{item.reason}</td>
                    <td>{item.organizationId ? "Organization" : "Tenant"}</td>
                    <td>{item.status}</td>
                    <td>{new Date(item.recordedAt).toLocaleString()}</td>
                    <td>{item.validUntil ? new Date(item.validUntil).toLocaleString() : "No expiry"}</td>
                    <td>{item.status === "ACTIVE" ? <button type="button" className={styles.danger} disabled={busyId === item.suppressionId} onClick={() => void revoke(item)}>{busyId === item.suppressionId ? "Revoking…" : "Revoke"}</button> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
