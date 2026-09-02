"use client";

import { useCallback, useEffect, useState } from "react";
import type { BlastRadius } from "@expadio/credential-custody";

/**
 * One governed console for a single connector. Surfaces the credential-custody
 * endpoints the fleet built but never showed:
 *   - GET  …/blast-radius   what breaks if this connector stops (never estimated)
 *   - GET  …/health         continuous credential probe status + allocation
 *   - GET  …/attestation    the signed revocation history an auditor downloads
 *   - POST …/revoke         provable, step-up-guarded, dual-controlled revocation
 *
 * Revocation carries a fresh `x-expadio-reauth-at` header (§3.4 step-up). A
 * platform-scoped connector additionally requires a second admin's approval
 * reference (§3.4 dual control), which the API asks for with a 403.
 */

interface HealthRecord {
  connectorKey: string;
  credentialState: string | null;
  probeStatus: "VALID" | "FAILING" | "INVALID";
  probeCheckedAt: string | null;
  probeError: string | null;
  probeWarnings: unknown[];
  custodyMode: string | null;
  failurePolicy: string | null;
  holdWindowSeconds: number | null;
  allocation: {
    transactionalMultiplier: number;
    bulkMultiplier: number;
    note: string;
  };
}

interface AttestationRow {
  attestation_id: string;
  revoked_at: string;
  revoked_by: string;
  leases_in_window: number;
  messages_rerouted: number;
  messages_cancelled: number;
  max_exposure_seconds: number;
  attestation_text: string;
  correlation_id: string;
}

interface ConnectorActionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectorKey: string;
  ownershipScope: "PLATFORM" | "TENANT";
  queryString?: string;
  onChanged: () => void;
}

const PROBE_COLORS: Record<string, { fg: string; bg: string }> = {
  VALID: { fg: "var(--theme-success)", bg: "color-mix(in srgb,var(--theme-success) 12%,transparent)" },
  FAILING: { fg: "var(--theme-warning)", bg: "color-mix(in srgb,var(--theme-warning) 12%,transparent)" },
  INVALID: { fg: "var(--theme-danger)", bg: "#fee2e2" },
};

export function ConnectorActionsModal({
  isOpen,
  onClose,
  connectorKey,
  ownershipScope,
  queryString = "",
  onChanged,
}: ConnectorActionsModalProps) {
  const [radius, setRadius] = useState<BlastRadius | null>(null);
  const [health, setHealth] = useState<HealthRecord | null>(null);
  const [attestations, setAttestations] = useState<AttestationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [approvalRef, setApprovalRef] = useState("");
  const [needsApproval, setNeedsApproval] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const base = `/api/communications/providers/${encodeURIComponent(connectorKey)}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [radiusRes, healthRes, attRes] = await Promise.allSettled([
      fetch(`${base}/blast-radius${queryString}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${base}/health${queryString}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${base}/attestation${queryString}`).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (radiusRes.status === "fulfilled") setRadius(radiusRes.value);
    if (healthRes.status === "fulfilled") setHealth(healthRes.value);
    if (attRes.status === "fulfilled" && attRes.value?.attestations) {
      setAttestations(attRes.value.attestations);
    } else {
      setAttestations([]);
    }
    setLoading(false);
  }, [base, queryString]);

  useEffect(() => {
    if (!isOpen) return;
    setRadius(null);
    setHealth(null);
    setAttestations([]);
    setError(null);
    setNotice(null);
    setNeedsApproval(false);
    setApprovalRef("");
    void load();
  }, [isOpen, load]);

  if (!isOpen) return null;

  async function handleRevoke() {
    if (!confirm(`Revoke the credential for ${connectorKey}? New send leases stop immediately and an attestation is produced.`)) {
      return;
    }
    setRevoking(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${base}/revoke${queryString}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // §3.4 — step-up: a fresh confirmation accompanies a destructive act.
          "x-expadio-reauth-at": new Date().toISOString(),
        },
        body: JSON.stringify(approvalRef.trim() ? { approvalRef: approvalRef.trim() } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.reasonKey === "DUAL_CONTROL_REQUIRED") {
          setNeedsApproval(true);
          setError(data.error || "A second platform admin's approval is required.");
          return;
        }
        throw new Error(data.error || data.message || "Revocation failed.");
      }
      setNotice(data.note || "Credential revoked. Attestation recorded.");
      setNeedsApproval(false);
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Revocation failed.");
    } finally {
      setRevoking(false);
    }
  }

  const probe = health ? PROBE_COLORS[health.probeStatus] ?? PROBE_COLORS.VALID : null;

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(15,23,42,.6)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(720px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "var(--surface, var(--theme-text-inverse))", border: "1px solid var(--line, #e2e8f0)", borderRadius: 16, padding: 28, boxShadow: "0 25px 50px -12px rgba(0,0,0,.25)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
          <div>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 800, color: "var(--brand, var(--theme-primary))" }}>
              Governed connector controls
            </span>
            <h2 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700 }}>{connectorKey}</h2>
            <div style={{ fontSize: 12, color: "var(--ink-500, #64748b)" }}>Ownership: {ownershipScope}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: "1px solid var(--line, #e2e8f0)", background: "transparent", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        {loading && <div style={{ padding: 20, textAlign: "center", color: "var(--ink-500, #64748b)" }}>Loading governed connector state…</div>}

        {/* Blast radius */}
        <section style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Blast radius</h3>
          {radius ? (
            <>
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink-700, #334155)", lineHeight: 1.5 }}>{radius.statement}</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                <Stat label="Tenants" value={radius.tenantCount} />
                <Stat label="Channels" value={radius.channels.length} />
                <Stat label="Msgs / 30d" value={radius.messagesLast30Days.toLocaleString("en-US")} />
                <Stat label="No fallback" value={radius.tenantsWithoutFallback} danger={radius.tenantsWithoutFallback > 0} />
              </div>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-500, #64748b)" }}>No routing or delivery history for this connector yet.</p>
          )}
        </section>

        {/* Credential health */}
        <section style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Credential health</h3>
            {probe && (
              <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: probe.fg, background: probe.bg }}>
                {health!.probeStatus}
              </span>
            )}
          </div>
          {health ? (
            <div style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--ink-600, #475569)" }}>
              <div>Credential state: <strong>{health.credentialState ?? "—"}</strong> · Custody: <strong>{health.custodyMode ?? "—"}</strong></div>
              <div>Last probe: <strong>{health.probeCheckedAt ? new Date(health.probeCheckedAt).toLocaleString() : "not yet probed"}</strong></div>
              {health.probeError && (
                <div style={{ color: "var(--theme-danger)" }}>Provider error: <span style={{ fontFamily: "monospace" }}>{health.probeError}</span></div>
              )}
              <div>
                Allocation on this probe — transactional ×{health.allocation.transactionalMultiplier}, bulk ×{health.allocation.bulkMultiplier}
              </div>
              <div style={{ fontSize: 11, fontStyle: "italic", color: "var(--ink-500, #64748b)" }}>{health.allocation.note}</div>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-500, #64748b)" }}>No credential on record for this connector.</p>
          )}
        </section>

        {/* Attestation history */}
        <section style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Revocation attestations</h3>
          {attestations.length > 0 ? (
            <div style={{ display: "grid", gap: 10 }}>
              {attestations.map((a) => (
                <div key={a.attestation_id} style={{ border: "1px solid var(--line, var(--theme-surface-muted))", borderRadius: 8, padding: 12, background: "#f8fafc" }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{new Date(a.revoked_at).toLocaleString()}</div>
                  <p style={{ margin: "6px 0", fontSize: 12, color: "var(--ink-700, #334155)", lineHeight: 1.5 }}>{a.attestation_text}</p>
                  <div style={{ fontSize: 11, color: "var(--ink-500, #64748b)" }}>
                    Exposure ≤ {a.max_exposure_seconds}s · rerouted {a.messages_rerouted} · cancelled {a.messages_cancelled} · corr <span style={{ fontFamily: "monospace" }}>{a.correlation_id}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: "var(--ink-500, #64748b)" }}>No revocation has been recorded for this connector.</p>
          )}
        </section>

        {error && <div role="alert" style={{ fontSize: 13, color: "var(--theme-danger)", background: "color-mix(in srgb,var(--theme-danger) 10%,transparent)", padding: 10, borderRadius: 8, marginBottom: 12 }}>⚠️ {error}</div>}
        {notice && <div style={{ fontSize: 13, color: "var(--theme-success)", background: "color-mix(in srgb,var(--theme-success) 10%,transparent)", padding: 10, borderRadius: 8, border: "1px solid #bbf7d0", marginBottom: 12 }}>✅ {notice}</div>}

        {(needsApproval || ownershipScope === "PLATFORM") && (
          <label style={{ display: "block", fontSize: 12, marginBottom: 12 }}>
            Second-admin approval reference {ownershipScope === "PLATFORM" ? "(required for platform connectors)" : ""}
            <input
              value={approvalRef}
              onChange={(e) => setApprovalRef(e.target.value)}
              placeholder="governance review id"
              style={{ width: "100%", marginTop: 4, padding: "6px 10px", border: "1px solid var(--line, #cbd5e1)", borderRadius: 6, fontSize: 12 }}
            />
          </label>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Close</button>
          <button
            type="button"
            onClick={handleRevoke}
            disabled={revoking}
            style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--theme-danger)", color: "var(--theme-text-inverse)", fontWeight: 700, cursor: revoking ? "not-allowed" : "pointer" }}
          >
            {revoking ? "Revoking…" : "Revoke credential"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div style={{ border: "1px solid var(--line, var(--theme-surface-muted))", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-500, #64748b)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: danger ? "var(--theme-danger)" : "var(--ink-900, var(--theme-text-primary))" }}>{value}</div>
    </div>
  );
}
