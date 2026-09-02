"use client";

import { useCallback, useEffect, useState } from "react";
import type { BlastRadius } from "@expadio/credential-custody";
import styles from "./ConnectorActionsModal.module.css";

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

function probeClass(status: HealthRecord["probeStatus"]): string {
  if (status === "VALID") return `${styles.statusBadge} ${styles.statusValid}`;
  if (status === "FAILING") return `${styles.statusBadge} ${styles.statusFailing}`;
  return `${styles.statusBadge} ${styles.statusInvalid}`;
}

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

  return (
    <div role="presentation" onClick={onClose} className={styles.backdrop}>
      <div onClick={(e) => e.stopPropagation()} className={styles.dialog}>
        <div className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Governed connector controls</span>
            <h2 className={styles.title}>{connectorKey}</h2>
            <div className={styles.meta}>Ownership: {ownershipScope}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.closeButton}>✕</button>
        </div>

        {loading && <div className={styles.loading}>Loading governed connector state…</div>}

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Blast radius</h3>
          {radius ? (
            <>
              <p className={styles.statement}>{radius.statement}</p>
              <div className={styles.statGrid}>
                <Stat label="Tenants" value={radius.tenantCount} />
                <Stat label="Channels" value={radius.channels.length} />
                <Stat label="Msgs / 30d" value={radius.messagesLast30Days.toLocaleString("en-US")} />
                <Stat label="No fallback" value={radius.tenantsWithoutFallback} danger={radius.tenantsWithoutFallback > 0} />
              </div>
            </>
          ) : (
            <p className={styles.empty}>No routing or delivery history for this connector yet.</p>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Credential health</h3>
            {health && <span className={probeClass(health.probeStatus)}>{health.probeStatus}</span>}
          </div>
          {health ? (
            <div className={styles.healthBody}>
              <div>Credential state: <strong>{health.credentialState ?? "—"}</strong> · Custody: <strong>{health.custodyMode ?? "—"}</strong></div>
              <div>Last probe: <strong>{health.probeCheckedAt ? new Date(health.probeCheckedAt).toLocaleString() : "not yet probed"}</strong></div>
              {health.probeError && (
                <div className={styles.providerError}>Provider error: <span className={styles.code}>{health.probeError}</span></div>
              )}
              <div>
                Allocation on this probe — transactional ×{health.allocation.transactionalMultiplier}, bulk ×{health.allocation.bulkMultiplier}
              </div>
              <div className={styles.note}>{health.allocation.note}</div>
            </div>
          ) : (
            <p className={styles.empty}>No credential on record for this connector.</p>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Revocation attestations</h3>
          {attestations.length > 0 ? (
            <div className={styles.attestationList}>
              {attestations.map((a) => (
                <div key={a.attestation_id} className={styles.attestation}>
                  <div className={styles.attestationTime}>{new Date(a.revoked_at).toLocaleString()}</div>
                  <p className={styles.attestationText}>{a.attestation_text}</p>
                  <div className={styles.attestationMeta}>
                    Exposure ≤ {a.max_exposure_seconds}s · rerouted {a.messages_rerouted} · cancelled {a.messages_cancelled} · corr <span className={styles.code}>{a.correlation_id}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>No revocation has been recorded for this connector.</p>
          )}
        </section>

        {error && <div role="alert" className={styles.bannerError}>⚠️ {error}</div>}
        {notice && <div className={styles.bannerNotice}>✅ {notice}</div>}

        {(needsApproval || ownershipScope === "PLATFORM") && (
          <label className={styles.approvalLabel}>
            Second-admin approval reference {ownershipScope === "PLATFORM" ? "(required for platform connectors)" : ""}
            <input
              value={approvalRef}
              onChange={(e) => setApprovalRef(e.target.value)}
              placeholder="governance review id"
              className={styles.approvalInput}
            />
          </label>
        )}

        <div className={styles.footer}>
          <button type="button" onClick={onClose} className={styles.secondaryButton}>Close</button>
          <button type="button" onClick={handleRevoke} disabled={revoking} className={styles.dangerButton}>
            {revoking ? "Revoking…" : "Revoke credential"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, danger = false }: { label: string; value: string | number; danger?: boolean }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={danger ? styles.statValueDanger : styles.statValue}>{value}</div>
    </div>
  );
}
