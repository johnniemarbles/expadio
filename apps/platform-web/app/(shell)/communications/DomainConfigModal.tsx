"use client";

import { useCallback, useEffect, useState } from "react";
import type { DomainRecord } from "../../api/communications/domains/route";
import { apiError } from "../../../lib/api-error";
import styles from "./DomainConfigModal.module.css";

interface DomainConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDomain?: string;
}

interface VerifyCheck {
  purpose: string;
  type: string;
  name: string;
  ok: boolean;
  detail: string;
}

interface CloudflareResult {
  ok?: boolean;
  name?: string;
  action?: string;
  detail?: string;
}

interface ProvisionResult {
  message?: string;
  cloudflare?: CloudflareResult[];
}

type RecordStatus = "VERIFIED" | "MISSING" | "NOT CHECKED" | "PROVIDER ISSUED";

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

function verificationClass(status: string) {
  if (status === "VERIFIED") return styles.statusVerified;
  if (status === "REVOKED") return styles.statusRevoked;
  return styles.statusPending;
}

function recordStatusClass(status: RecordStatus) {
  return status === "VERIFIED"
    ? `${styles.recordStatus} ${styles.recordStatusVerified}`
    : styles.recordStatus;
}

function recordStatus(
  record: DomainRecord["dnsRecords"][number],
  checks: VerifyCheck[] | undefined,
): RecordStatus {
  if (!record.verifiable) return "PROVIDER ISSUED";
  const observation = checks?.find(
    (check) => check.purpose === record.purpose && check.name === record.name,
  );
  if (!observation) return "NOT CHECKED";
  return observation.ok ? "VERIFIED" : "MISSING";
}

export function DomainConfigModal({ isOpen, onClose, initialDomain = "expadio.com" }: DomainConfigModalProps) {
  const [domain, setDomain] = useState(initialDomain);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [domains, setDomains] = useState<DomainRecord[]>([]);
  const [lastProvisionResult, setLastProvisionResult] = useState<ProvisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyCheck[]>>({});
  const [apiToken, setApiToken] = useState("");
  const [adding, setAdding] = useState(false);

  const normalizedDomain = domain.trim().toLowerCase();
  const domainValid = DOMAIN_RE.test(normalizedDomain);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/communications/domains${window.location.search}`);
    const data = await res.json();
    if (Array.isArray(data)) setDomains(data);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setFetching(true);
    reload().catch((err) => console.error("Error loading domains:", err)).finally(() => setFetching(false));
  }, [isOpen, reload]);

  if (!isOpen) return null;

  async function handleAutoConfigure() {
    if (!domainValid) {
      setError("Enter a valid domain such as mail.example.com.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/communications/domains/cloudflare${window.location.search}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: normalizedDomain, apiToken: apiToken.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Failed to configure DNS records"));
      setLastProvisionResult(data);
      await reload();
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to configure DNS records"));
    } finally {
      setLoading(false);
    }
  }

  async function handleAddManual() {
    if (!domainValid) {
      setError("Enter a valid domain such as mail.example.com.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/communications/domains${window.location.search}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: normalizedDomain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not add the domain"));
      setLastProvisionResult({ message: `Added ${normalizedDomain} as PENDING. Add the DNS records below, then Verify.` });
      await reload();
    } catch (err: unknown) {
      setError(errorMessage(err, "Could not add the domain"));
    } finally {
      setAdding(false);
    }
  }

  async function handleVerify(senderId: string) {
    setBusyId(senderId);
    setError(null);
    try {
      const res = await fetch(`/api/communications/domains/${encodeURIComponent(senderId)}/verify${window.location.search}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Verification failed"));
      setVerifyResults((prev) => ({ ...prev, [senderId]: data.checks ?? [] }));
      await reload();
    } catch (err: unknown) {
      setError(errorMessage(err, "Verification failed"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(senderId: string, domainName: string) {
    if (!confirm(`Retire the sending domain ${domainName}? It will stop being usable for dispatch.`)) return;
    setBusyId(senderId);
    setError(null);
    try {
      const res = await fetch(`/api/communications/domains/${encodeURIComponent(senderId)}${window.location.search}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not retire the domain"));
      await reload();
    } catch (err: unknown) {
      setError(errorMessage(err, "Could not retire the domain"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>DNS &amp; Identity Preflight</p>
            <h2 className={styles.title}>Sending Domains &amp; DKIM Authentication</h2>
          </div>
          <button type="button" onClick={onClose} className={styles.closeButton} aria-label="Close">✕</button>
        </div>

        <p className={styles.description}>
          Sending domains require verified DNS records before governed email dispatch is permitted. The table shows required records; live observations appear only after an explicit Verify check.
        </p>

        <div className={styles.actionPanel}>
          <div className={styles.fieldset}>
            <label className={styles.label}>Sending domain
              <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="e.g. mail.yourbrand.com" className={domain && !domainValid ? styles.inputInvalid : styles.input} />
              {domain && !domainValid && <span className={styles.invalidText}>Enter a valid domain such as mail.example.com.</span>}
            </label>
            <label className={styles.label}>Cloudflare API token <span className={styles.optionalText}>(optional if the deployment has one)</span>
              <input type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)} placeholder="Token with Zone · DNS · Edit for this domain" autoComplete="off" className={styles.input} />
              <span className={styles.helpText}>Used once to create the records, then discarded — never stored. The zone is discovered automatically from the domain.</span>
            </label>
            <div className={styles.actions}>
              <button type="button" onClick={handleAutoConfigure} disabled={loading || adding || !domainValid} className={styles.primaryButton}>{loading ? "Provisioning DNS…" : "⚡ Auto-Configure with Cloudflare"}</button>
              <button type="button" onClick={handleAddManual} disabled={loading || adding || !domainValid} className={styles.secondaryButton}>{adding ? "Adding…" : "Add without Cloudflare"}</button>
            </div>
          </div>

          {error && <div className={styles.alert} role="alert">⚠️ {error}</div>}
          {lastProvisionResult && (
            <div className={styles.success}>
              ✅ {lastProvisionResult.message}
              {Array.isArray(lastProvisionResult.cloudflare) && lastProvisionResult.cloudflare.length > 0 && (
                <div className={styles.cloudflareList}>
                  {lastProvisionResult.cloudflare.map((r, i) => <div key={i} className={`${styles.checkLine} ${r.ok ? styles.checkGood : styles.checkBad} ${styles.mono}`}>{r.ok ? "✓" : "✗"} {r.name} — {r.action ?? r.detail}</div>)}
                </div>
              )}
            </div>
          )}
        </div>

        <h3 className={styles.sectionTitle}>Configured Sender Identities &amp; DNS Requirements</h3>
        {fetching ? <div className={styles.loading}>Loading domain configurations...</div> : domains.length > 0 ? (
          <div className={styles.domainList}>
            {domains.map((d) => (
              <div key={d.senderId} className={styles.domainCard}>
                <div className={styles.domainHeader}>
                  <div><strong className={styles.domainName}>{d.domain}</strong><div className={styles.domainAddress}>{d.address}</div></div>
                  <div className={styles.domainActions}>
                    <span className={verificationClass(d.verificationStatus)}>{d.verificationStatus}</span>
                    <button type="button" onClick={() => handleVerify(d.senderId)} disabled={busyId === d.senderId} className={styles.smallButton}>{busyId === d.senderId ? "…" : "Verify"}</button>
                    <button type="button" onClick={() => handleRemove(d.senderId, d.domain)} disabled={busyId === d.senderId} className={styles.dangerButton}>Remove</button>
                  </div>
                </div>

                {verifyResults[d.senderId] && (
                  <div className={styles.checkList}>
                    {verifyResults[d.senderId].map((c, i) => <div key={i} className={`${styles.checkLine} ${c.ok ? styles.checkGood : styles.checkBad}`}>{c.ok ? "✅" : "⚠️"} <strong>{c.purpose}</strong> — {c.detail}</div>)}
                  </div>
                )}

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead><tr><th>Record Type</th><th>Host / Selector</th><th>Value</th><th>Verification</th></tr></thead>
                    <tbody>
                      {d.dnsRecords?.map((r, idx) => {
                        const status = recordStatus(r, verifyResults[d.senderId]);
                        return (
                          <tr key={idx}>
                            <td className={styles.recordType}><code>{r.type}</code></td>
                            <td className={styles.recordName}>{r.name}</td>
                            <td className={styles.recordValue}>{r.value}</td>
                            <td><span className={recordStatusClass(status)}>{status}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : <div className={styles.empty}>No sending domains configured. Click Auto-Configure above to register your first sending domain.</div>}
      </div>
    </div>
  );
}
