"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";
import type { DomainRecord } from "../../api/communications/domains/route";
import { apiError } from "../../../lib/api-error";

interface DomainConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDomain?: string;
}

interface VerifyCheck { purpose: string; type: string; name: string; ok: boolean; detail: string }

export function DomainConfigModal({ isOpen, onClose, initialDomain = "expadio.com" }: DomainConfigModalProps) {
  const [domain, setDomain] = useState(initialDomain);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [domains, setDomains] = useState<DomainRecord[]>([]);
  const [lastProvisionResult, setLastProvisionResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyCheck[]>>({});
  const [apiToken, setApiToken] = useState("");
  const [adding, setAdding] = useState(false);

  const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  const domainValid = DOMAIN_RE.test(domain.trim().toLowerCase());

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
    if (!domainValid) { setError("Enter a valid domain such as mail.example.com."); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/communications/domains/cloudflare${window.location.search}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domain.trim().toLowerCase(), apiToken: apiToken.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Failed to configure DNS records"));
      setLastProvisionResult(data);
      await reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddManual() {
    if (!domainValid) { setError("Enter a valid domain such as mail.example.com."); return; }
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/communications/domains${window.location.search}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domain.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not add the domain"));
      setLastProvisionResult({ message: `Added ${domain.trim().toLowerCase()} as PENDING. Add the DNS records below, then Verify.` });
      await reload();
    } catch (err: any) {
      setError(err.message);
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
    } catch (err: any) {
      setError(err.message);
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
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.6)",
        backdropFilter: "blur(6px)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--surface, var(--theme-text-inverse)fff)",
          border: "1px solid var(--line, #e2e8f0)",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "760px",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "28px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
          <div>
            <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 800, color: "var(--brand, var(--theme-primary))" }}>
              DNS &amp; Identity Preflight
            </span>
            <h2 style={{ margin: "4px 0 0", fontSize: "20px", fontWeight: 700 }}>
              Sending Domains &amp; DKIM Authentication
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid var(--line, #e2e8f0)",
              background: "transparent",
              borderRadius: "8px",
              width: "32px",
              height: "32px",
              cursor: "pointer",
              fontSize: "16px",
              display: "grid",
              placeItems: "center",
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ margin: "0 0 20px", fontSize: "14px", color: "var(--ink-600, #475569)", lineHeight: 1.5 }}>
          Sending domains require verified DNS records (DKIM selector keys, SPF inbound authorisation, DMARC alignment, and MX routing) before governed email dispatch is permitted.
        </p>

        {/* Action Panel */}
        <div
          style={{
            padding: "18px",
            border: "1px solid #fed7aa",
            borderRadius: "12px",
            background: "var(--theme-text-inverse)af5",
            marginBottom: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          <div style={{ display: "grid", gap: "10px" }}>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "#9a3412", display: "grid", gap: "4px" }}>
              Sending domain
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="e.g. mail.yourbrand.com"
                style={{ padding: "8px 12px", border: `1px solid ${domain && !domainValid ? "#f87171" : "#fdba74"}`, borderRadius: "8px", fontSize: "13px", outline: "none", background: "var(--theme-text-inverse)" }}
              />
              {domain && !domainValid && <span style={{ fontSize: "11px", color: "var(--theme-danger)", fontWeight: 500 }}>Enter a valid domain such as mail.example.com.</span>}
            </label>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "#9a3412", display: "grid", gap: "4px" }}>
              Cloudflare API token <span style={{ fontWeight: 500, color: "#9a3412aa" }}>(optional if the deployment has one)</span>
              <input
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="Token with Zone · DNS · Edit for this domain"
                autoComplete="off"
                style={{ padding: "8px 12px", border: "1px solid #fdba74", borderRadius: "8px", fontSize: "13px", outline: "none", background: "var(--theme-text-inverse)" }}
              />
              <span style={{ fontSize: "11px", color: "#9a3412aa", fontWeight: 500 }}>Used once to create the records, then discarded — never stored. The zone is discovered automatically from the domain.</span>
            </label>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handleAutoConfigure}
                disabled={loading || adding || !domainValid}
                className={styles.btnOutlineOrange}
                style={{ padding: "8px 18px", cursor: loading || !domainValid ? "not-allowed" : "pointer" }}
              >
                {loading ? "Provisioning DNS…" : "⚡ Auto-Configure with Cloudflare"}
              </button>
              <button
                type="button"
                onClick={handleAddManual}
                disabled={loading || adding || !domainValid}
                style={{ padding: "8px 18px", borderRadius: "999px", border: "1px solid #cbd5e1", background: "var(--theme-text-inverse)", cursor: adding || !domainValid ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 700 }}
              >
                {adding ? "Adding…" : "Add without Cloudflare"}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ fontSize: "13px", color: "var(--theme-danger)", background: "color-mix(in srgb,var(--theme-danger) 10%,transparent)", padding: "10px", borderRadius: "8px" }}>
              ⚠️ {error}
            </div>
          )}

          {lastProvisionResult && (
            <div style={{ fontSize: "13px", color: "var(--theme-success)", background: "color-mix(in srgb,var(--theme-success) 10%,transparent)", padding: "10px", borderRadius: "8px", border: "1px solid #bbf7d0" }}>
              ✅ {lastProvisionResult.message}
              {Array.isArray(lastProvisionResult.cloudflare) && lastProvisionResult.cloudflare.length > 0 && (
                <div style={{ marginTop: "6px", display: "grid", gap: "2px" }}>
                  {lastProvisionResult.cloudflare.map((r: any, i: number) => (
                    <div key={i} style={{ fontSize: "11px", color: r.ok ? "var(--theme-success)" : "var(--theme-danger)", fontFamily: "monospace" }}>
                      {r.ok ? "✓" : "✗"} {r.name} — {r.action ?? r.detail}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Existing Domains / DNS Records Table */}
        <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 12px" }}>
          Configured Sender Identities &amp; DNS Selectors
        </h3>

        {fetching ? (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--ink-500, #64748b)" }}>
            Loading domain configurations...
          </div>
        ) : domains.length > 0 ? (
          <div style={{ display: "grid", gap: "16px" }}>
            {domains.map((d) => (
              <div
                key={d.senderId}
                style={{
                  border: "1px solid var(--line, #e2e8f0)",
                  borderRadius: "10px",
                  padding: "16px",
                  background: "var(--surface, var(--theme-text-inverse)fff)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div>
                    <strong style={{ fontSize: "14px" }}>{d.domain}</strong>
                    <div style={{ fontSize: "12px", color: "var(--ink-500, #64748b)" }}>{d.address}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        padding: "3px 10px",
                        borderRadius: "999px",
                        fontSize: "11px",
                        fontWeight: 800,
                        color: d.verificationStatus === "VERIFIED" ? "var(--theme-success)" : d.verificationStatus === "REVOKED" ? "var(--theme-danger)" : "var(--theme-warning)",
                        background: d.verificationStatus === "VERIFIED" ? "color-mix(in srgb,var(--theme-success) 12%,transparent)" : d.verificationStatus === "REVOKED" ? "#fee2e2" : "color-mix(in srgb,var(--theme-warning) 12%,transparent)",
                      }}
                    >
                      {d.verificationStatus}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleVerify(d.senderId)}
                      disabled={busyId === d.senderId}
                      style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "6px", border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer", fontWeight: 700 }}
                    >
                      {busyId === d.senderId ? "…" : "Verify"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(d.senderId, d.domain)}
                      disabled={busyId === d.senderId}
                      style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "6px", border: "1px solid color-mix(in srgb,var(--theme-danger) 28%,transparent)", background: "transparent", color: "var(--theme-danger)", cursor: "pointer", fontWeight: 700 }}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {verifyResults[d.senderId] && (
                  <div style={{ marginBottom: "12px", display: "grid", gap: "4px" }}>
                    {verifyResults[d.senderId].map((c, i) => (
                      <div key={i} style={{ fontSize: "11px", color: c.ok ? "var(--theme-success)" : "var(--theme-danger)" }}>
                        {c.ok ? "✅" : "⚠️"} <strong>{c.purpose}</strong> — {c.detail}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--ink-500, #64748b)" }}>
                        <th style={{ padding: "6px 8px" }}>Record Type</th>
                        <th style={{ padding: "6px 8px" }}>Host / Selector</th>
                        <th style={{ padding: "6px 8px" }}>Value</th>
                        <th style={{ padding: "6px 8px" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.dnsRecords?.map((r, idx) => (
                        <tr key={idx} style={{ borderTop: "1px solid var(--line, var(--theme-surface-muted))" }}>
                          <td style={{ padding: "6px 8px", fontWeight: 700 }}><code>{r.type}</code></td>
                          <td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{r.name}</td>
                          <td style={{ padding: "6px 8px", fontFamily: "monospace", maxWidth: "240px", overflow: "hidden", textOverflow: "ellipsis", var(--theme-text-inverse)Space: "nowrap" }}>
                            {r.value}
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <span style={{ color: r.status === "VERIFIED" ? "var(--theme-success)" : "#ca8a04", fontWeight: 700 }}>
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--ink-500, #64748b)" }}>
            No sending domains configured. Click Auto-Configure above to register your first sending domain.
          </div>
        )}
      </div>
    </div>
  );
}
