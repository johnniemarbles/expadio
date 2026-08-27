"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";
import type { DomainRecord } from "../../api/communications/domains/route";

interface DomainConfigModalProps { isOpen: boolean; onClose: () => void; initialDomain?: string; }

export function DomainConfigModal({ isOpen, onClose, initialDomain = "" }: DomainConfigModalProps) {
  const [domain, setDomain] = useState(initialDomain);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [domains, setDomains] = useState<DomainRecord[]>([]);
  const [lastProvisionResult, setLastProvisionResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setFetching(true); setError(null); setLastProvisionResult(null);
    fetch(`/api/communications/domains${window.location.search}`, { cache: "no-store" })
      .then(async (res) => { const data = await res.json(); if (!res.ok) throw new Error(data.error || "Failed to load domains."); return data; })
      .then((data) => { if (Array.isArray(data)) setDomains(data); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load domains."))
      .finally(() => setFetching(false));
  }, [isOpen]);

  useEffect(() => { if (isOpen) setDomain(initialDomain); }, [initialDomain, isOpen]);

  if (!isOpen) return null;

  async function handleAutoConfigure() {
    const value = domain.trim().toLowerCase();
    if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)) {
      setError("Enter a valid domain such as mail.example.com."); return;
    }
    setLoading(true); setError(null); setLastProvisionResult(null);
    try {
      const res = await fetch(`/api/communications/domains/cloudflare${window.location.search}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to configure DNS records.");
      setLastProvisionResult(data);
      const domainsRes = await fetch(`/api/communications/domains${window.location.search}`, { cache: "no-store" });
      const domainsData = await domainsRes.json();
      if (!domainsRes.ok) throw new Error(domainsData.error || "Domain was configured but could not be reloaded.");
      if (Array.isArray(domainsData)) setDomains(domainsData);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to configure DNS records."); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(15,23,42,.6)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", zIndex: 100, padding: 20 }} onClick={onClose}>
      <div style={{ background: "var(--surface,#fff)", border: "1px solid var(--line,#e2e8f0)", borderRadius: 16, width: "100%", maxWidth: 760, maxHeight: "90vh", overflowY: "auto", padding: 28, boxShadow: "0 25px 50px -12px rgba(0,0,0,.25)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div><span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 800, color: "var(--brand,#4f46e5)" }}>DNS &amp; Identity Preflight</span><h2 style={{ margin: "4px 0 0", fontSize: 20 }}>Sending Domains &amp; DKIM Authentication</h2></div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: "1px solid var(--line,#e2e8f0)", background: "transparent", borderRadius: 8, width: 32, height: 32, cursor: "pointer" }}>✕</button>
        </div>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "var(--ink-600,#475569)", lineHeight: 1.5 }}>Sending domains require verified DNS records before governed email dispatch is permitted.</p>
        <div style={{ padding: 18, border: "1px solid #fed7aa", borderRadius: 12, background: "#fffaf5", marginBottom: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label htmlFor="communications-domain" style={{ fontSize: 13, fontWeight: 700, color: "#9a3412" }}>Domain Name:</label>
            <input id="communications-domain" type="text" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourbrand.com" autoComplete="off" style={{ flex: "1 1 200px", padding: "8px 12px", border: "1px solid #fdba74", borderRadius: 8, fontSize: 13 }} />
            <button type="button" onClick={handleAutoConfigure} disabled={loading} className={styles.btnOutlineOrange}>{loading ? "Provisioning DNS..." : "⚡ Auto-Configure with Cloudflare"}</button>
          </div>
          {error && <div role="alert" style={{ fontSize: 13, color: "#b91c1c", background: "#fef2f2", padding: 10, borderRadius: 8 }}>⚠️ {error}</div>}
          {lastProvisionResult && <div role="status" style={{ fontSize: 13, color: "#15803d", background: "#f0fdf4", padding: 10, borderRadius: 8, border: "1px solid #bbf7d0" }}>✅ {lastProvisionResult.message || "Domain configuration completed."}</div>}
        </div>
        <h3 style={{ fontSize: 15, margin: "0 0 12px" }}>Configured Sender Identities &amp; DNS Selectors</h3>
        {fetching ? <div style={{ padding: 20, textAlign: "center", color: "var(--ink-500,#64748b)" }}>Loading domain configurations...</div> : domains.length > 0 ? <div style={{ display: "grid", gap: 16 }}>{domains.map((d) => <div key={d.senderId} style={{ border: "1px solid var(--line,#e2e8f0)", borderRadius: 10, padding: 16 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><div><strong style={{ fontSize: 14 }}>{d.domain}</strong><div style={{ fontSize: 12, color: "var(--ink-500,#64748b)" }}>{d.address}</div></div><span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: d.verificationStatus === "VERIFIED" ? "#166534" : "#925b0b", background: d.verificationStatus === "VERIFIED" ? "#dcfce7" : "#fef3c7" }}>{d.verificationStatus}</span></div><div style={{ overflowX: "auto" }}><table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}><thead><tr style={{ textAlign: "left", color: "var(--ink-500,#64748b)" }}><th style={{ padding: "6px 8px" }}>Record Type</th><th style={{ padding: "6px 8px" }}>Host / Selector</th><th style={{ padding: "6px 8px" }}>Value</th><th style={{ padding: "6px 8px" }}>Status</th></tr></thead><tbody>{d.dnsRecords?.map((r, idx) => <tr key={idx} style={{ borderTop: "1px solid var(--line,#f1f5f9)" }}><td style={{ padding: "6px 8px", fontWeight: 700 }}><code>{r.type}</code></td><td style={{ padding: "6px 8px", fontFamily: "monospace" }}>{r.name}</td><td style={{ padding: "6px 8px", fontFamily: "monospace", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.value}</td><td style={{ padding: "6px 8px" }}><span style={{ color: r.status === "VERIFIED" ? "#16a34a" : "#ca8a04", fontWeight: 700 }}>{r.status}</span></td></tr>)}</tbody></table></div></div>)}</div> : <div style={{ padding: 20, textAlign: "center", color: "var(--ink-500,#64748b)" }}>No sending domains configured. Enter your domain above to begin.</div>}
      </div>
    </div>
  );
}
