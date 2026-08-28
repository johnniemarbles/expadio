"use client";

import { useState } from "react";
import type { CrmAccount, CrmContact } from "@expadio/party";
import type { CrmLead, LeadStage } from "@expadio/lead";
import type { CrmCase, CaseStatus } from "@expadio/case";
import { apiError } from "../../../lib/api-error";

type ContactRow = CrmContact & { accountName: string | null };
type LeadRow = CrmLead & { accountName: string | null };
type CaseRow = CrmCase & { accountName: string | null };

const CASE_STATUSES: CaseStatus[] = ["OPEN", "PENDING", "RESOLVED", "CLOSED"];
const CASE_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const CASE_STATUS_TONE: Record<string, { fg: string; bg: string }> = {
  OPEN: { fg: "#3730a3", bg: "#e0e7ff" },
  PENDING: { fg: "#925b0b", bg: "#fef3c7" },
  RESOLVED: { fg: "#166534", bg: "#dcfce7" },
  CLOSED: { fg: "#475569", bg: "#f1f5f9" },
};
const PRIORITY_TONE: Record<string, string> = { URGENT: "#b91c1c", HIGH: "#c2410c", NORMAL: "#475569", LOW: "#94a3b8" };

const LEAD_STAGES: LeadStage[] = ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"];
const LEAD_TONE: Record<string, { fg: string; bg: string }> = {
  NEW: { fg: "#475569", bg: "#f1f5f9" },
  QUALIFIED: { fg: "#925b0b", bg: "#fef3c7" },
  PROPOSAL: { fg: "#3730a3", bg: "#e0e7ff" },
  WON: { fg: "#166534", bg: "#dcfce7" },
  LOST: { fg: "#991b1b", bg: "#fee2e2" },
};

function money(minor: number | null, currency: string): string {
  if (minor === null) return "—";
  return `${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })} ${currency}`;
}

const STAGES = ["PROSPECT", "LEAD", "OPPORTUNITY", "CUSTOMER", "CHURNED"] as const;
const STAGE_TONE: Record<string, { fg: string; bg: string }> = {
  PROSPECT: { fg: "#475569", bg: "#f1f5f9" },
  LEAD: { fg: "#925b0b", bg: "#fef3c7" },
  OPPORTUNITY: { fg: "#3730a3", bg: "#e0e7ff" },
  CUSTOMER: { fg: "#166534", bg: "#dcfce7" },
  CHURNED: { fg: "#991b1b", bg: "#fee2e2" },
};

interface CrmClientProps {
  initialAccounts: CrmAccount[];
  initialContacts: ContactRow[];
  initialLeads: LeadRow[];
  initialCases: CaseRow[];
  queryString?: string;
}

const inp: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line, #cbd5e1)", borderRadius: 8, fontSize: 13, outline: "none",
};

export function CrmClient({ initialAccounts, initialContacts, initialLeads, initialCases, queryString = "" }: CrmClientProps) {
  const [tab, setTab] = useState<"accounts" | "contacts" | "leads" | "cases">("accounts");
  const [accounts, setAccounts] = useState<CrmAccount[]>(initialAccounts);
  const [contacts, setContacts] = useState<ContactRow[]>(initialContacts);
  const [leads, setLeads] = useState<LeadRow[]>(initialLeads);
  const [cases, setCases] = useState<CaseRow[]>(initialCases);
  const [showAccount, setShowAccount] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showLead, setShowLead] = useState(false);
  const [showCase, setShowCase] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [movingLead, setMovingLead] = useState<string | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [movingCase, setMovingCase] = useState<string | null>(null);

  async function reloadAccounts() {
    const res = await fetch(`/api/crm/accounts${queryString}`);
    if (res.ok) { const d = await res.json(); if (Array.isArray(d)) setAccounts(d); }
  }
  async function reloadContacts() {
    const res = await fetch(`/api/crm/contacts${queryString}`);
    if (res.ok) { const d = await res.json(); if (Array.isArray(d)) setContacts(d); }
  }
  async function reloadLeads() {
    const res = await fetch(`/api/crm/leads${queryString}`);
    if (res.ok) { const d = await res.json(); if (Array.isArray(d)) setLeads(d); }
  }

  async function moveLead(leadId: string, stage: LeadStage) {
    setMovingLead(leadId); setLeadError(null);
    try {
      const res = await fetch(`/api/crm/leads/${encodeURIComponent(leadId)}${queryString}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not move the lead."));
      setLeads((prev) => prev.map((l) => (l.leadId === leadId ? { ...l, stage } : l)));
    } catch (cause) {
      setLeadError(cause instanceof Error ? cause.message : "Could not move the lead.");
    } finally {
      setMovingLead(null);
    }
  }

  async function reloadCases() {
    const res = await fetch(`/api/crm/cases${queryString}`);
    if (res.ok) { const d = await res.json(); if (Array.isArray(d)) setCases(d); }
  }
  async function moveCase(caseId: string, status: CaseStatus) {
    setMovingCase(caseId); setCaseError(null);
    try {
      const res = await fetch(`/api/crm/cases/${encodeURIComponent(caseId)}${queryString}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not update the case."));
      setCases((prev) => prev.map((c) => (c.caseId === caseId ? { ...c, status } : c)));
    } catch (cause) {
      setCaseError(cause instanceof Error ? cause.message : "Could not update the case.");
    } finally {
      setMovingCase(null);
    }
  }

  const openCases = cases.filter((c) => c.status === "OPEN" || c.status === "PENDING").length;
  const openPipelineMinor = leads.filter((l) => l.stage !== "WON" && l.stage !== "LOST").reduce((s, l) => s + (l.amountMinorUnits ?? 0), 0);
  const wonMinor = leads.filter((l) => l.stage === "WON").reduce((s, l) => s + (l.amountMinorUnits ?? 0), 0);
  const pipeCurrency = leads[0]?.currency ?? "USD";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--ink-500, #64748b)" }}>Business engine / CRM</div>
          <h1 style={{ margin: "4px 0 0", fontSize: 24 }}>Customer relationships</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--ink-600, #475569)" }}>Accounts and contacts for this workspace, isolated by tenant.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={() => setShowAccount(true)} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, #4f46e5)", color: "white", fontWeight: 700, cursor: "pointer" }}>+ New account</button>
          <button type="button" onClick={() => setShowContact(true)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", fontWeight: 700, cursor: "pointer" }}>+ New contact</button>
          <button type="button" onClick={() => setShowLead(true)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", fontWeight: 700, cursor: "pointer" }}>+ New lead</button>
          <button type="button" onClick={() => setShowCase(true)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", fontWeight: 700, cursor: "pointer" }}>+ New case</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <Stat label="Accounts" value={accounts.length} />
        <Stat label="Open pipeline" value={money(openPipelineMinor, pipeCurrency)} />
        <Stat label="Won" value={money(wonMinor, pipeCurrency)} />
        <Stat label="Open cases" value={openCases} />
      </div>

      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--line, #e2e8f0)" }}>
        {(["accounts", "contacts", "leads", "cases"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} style={{ padding: "8px 14px", border: 0, background: "transparent", cursor: "pointer", fontWeight: 700, fontSize: 14, color: tab === t ? "var(--brand, #4f46e5)" : "var(--ink-500, #64748b)", borderBottom: tab === t ? "2px solid var(--brand, #4f46e5)" : "2px solid transparent" }}>
            {t === "accounts" ? "Accounts" : t === "contacts" ? "Contacts" : t === "leads" ? "Leads" : "Cases"}
          </button>
        ))}
      </div>

      {tab === "accounts" ? (
        <Panel>
          {accounts.length > 0 ? (
            <Table head={["Account", "Domain", "Industry", "Stage", "Created"]}>
              {accounts.map((a) => {
                const tone = STAGE_TONE[a.lifecycleStage] ?? STAGE_TONE.PROSPECT;
                return (
                  <tr key={a.accountId} style={{ borderTop: "1px solid var(--line, #f1f5f9)" }}>
                    <td style={td}><strong>{a.name}</strong></td>
                    <td style={td}>{a.domain ?? "—"}</td>
                    <td style={td}>{a.industry ?? "—"}</td>
                    <td style={td}><span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: tone.fg, background: tone.bg }}>{a.lifecycleStage}</span></td>
                    <td style={td}>{new Date(a.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty title="No accounts yet" desc="Create your first customer account to start building the pipeline." />
          )}
        </Panel>
      ) : tab === "contacts" ? (
        <Panel>
          {contacts.length > 0 ? (
            <Table head={["Contact", "Email", "Phone", "Title", "Account"]}>
              {contacts.map((c) => (
                <tr key={c.contactId} style={{ borderTop: "1px solid var(--line, #f1f5f9)" }}>
                  <td style={td}><strong>{c.fullName}</strong></td>
                  <td style={td}>{c.email ?? "—"}</td>
                  <td style={td}>{c.phone ?? "—"}</td>
                  <td style={td}>{c.title ?? "—"}</td>
                  <td style={td}>{c.accountName ?? "—"}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty title="No contacts yet" desc="Add people and optionally attach them to an account." />
          )}
        </Panel>
      ) : tab === "leads" ? (
        <Panel>
          {leadError && <div role="alert" style={{ fontSize: 12, color: "#b91c1c", padding: "0 8px 8px" }}>⚠️ {leadError}</div>}
          {leads.length > 0 ? (
            <Table head={["Lead", "Account", "Amount", "Source", "Stage", ""]}>
              {leads.map((l) => {
                const tone = LEAD_TONE[l.stage] ?? LEAD_TONE.NEW;
                return (
                  <tr key={l.leadId} style={{ borderTop: "1px solid var(--line, #f1f5f9)" }}>
                    <td style={td}><strong>{l.title}</strong></td>
                    <td style={td}>{l.accountName ?? "—"}</td>
                    <td style={td}>{money(l.amountMinorUnits, l.currency)}</td>
                    <td style={td}>{l.source ?? "—"}</td>
                    <td style={td}><span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: tone.fg, background: tone.bg }}>{l.stage}</span></td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <select
                        value={l.stage}
                        disabled={movingLead === l.leadId}
                        onChange={(e) => moveLead(l.leadId, e.target.value as LeadStage)}
                        aria-label={`Move ${l.title}`}
                        style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line, #cbd5e1)" }}
                      >
                        {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty title="No leads yet" desc="Create a lead to start tracking the pipeline. Move it through stages as it progresses." />
          )}
        </Panel>
      ) : (
        <Panel>
          {caseError && <div role="alert" style={{ fontSize: 12, color: "#b91c1c", padding: "0 8px 8px" }}>⚠️ {caseError}</div>}
          {cases.length > 0 ? (
            <Table head={["Case", "Account", "Priority", "Blueprint", "Status", ""]}>
              {cases.map((c) => {
                const tone = CASE_STATUS_TONE[c.status] ?? CASE_STATUS_TONE.OPEN;
                return (
                  <tr key={c.caseId} style={{ borderTop: "1px solid var(--line, #f1f5f9)" }}>
                    <td style={td}><strong>{c.subject}</strong></td>
                    <td style={td}>{c.accountName ?? "—"}</td>
                    <td style={td}><span style={{ fontWeight: 700, color: PRIORITY_TONE[c.priority] ?? "#475569" }}>{c.priority}</span></td>
                    <td style={td}>{c.blueprintKey ? <code style={{ fontSize: 11 }}>{c.blueprintKey}</code> : <span style={{ color: "var(--ink-500, #64748b)" }}>—</span>}</td>
                    <td style={td}><span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: tone.fg, background: tone.bg }}>{c.status}</span></td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <select
                        value={c.status}
                        disabled={movingCase === c.caseId}
                        onChange={(e) => moveCase(c.caseId, e.target.value as CaseStatus)}
                        aria-label={`Update ${c.subject}`}
                        style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line, #cbd5e1)" }}
                      >
                        {CASE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty title="No cases yet" desc="Open a case to track a unit of work. Link it to the workflow blueprint that will govern it." />
          )}
        </Panel>
      )}

      {showAccount && (
        <AccountModal
          queryString={queryString}
          onClose={() => setShowAccount(false)}
          onCreated={() => { setShowAccount(false); reloadAccounts(); }}
        />
      )}
      {showContact && (
        <ContactModal
          accounts={accounts}
          queryString={queryString}
          onClose={() => setShowContact(false)}
          onCreated={() => { setShowContact(false); reloadContacts(); }}
        />
      )}
      {showLead && (
        <LeadModal
          accounts={accounts}
          queryString={queryString}
          onClose={() => setShowLead(false)}
          onCreated={() => { setShowLead(false); reloadLeads(); }}
        />
      )}
      {showCase && (
        <CaseModal
          accounts={accounts}
          queryString={queryString}
          onClose={() => setShowCase(false)}
          onCreated={() => { setShowCase(false); reloadCases(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-500, #64748b)" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800 }}>{value}</div>
    </div>
  );
}
function Panel({ children }: { children: React.ReactNode }) {
  return <section style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 12, padding: 12, overflowX: "auto" }}>{children}</section>;
}
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
      <thead><tr style={{ textAlign: "left", color: "var(--ink-500, #64748b)", fontSize: 12 }}>{head.map((h) => <th key={h} style={{ padding: "8px" }}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  );
}
const td: React.CSSProperties = { padding: "8px" };
function Empty({ title, desc }: { title: string; desc: string }) {
  return <div style={{ padding: 30, textAlign: "center", color: "var(--ink-500, #64748b)" }}><div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div><div style={{ fontSize: 13 }}>{desc}</div></div>;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div role="presentation" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(15,23,42,.6)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 100%)", background: "var(--surface, #fff)", borderRadius: 16, padding: 24, display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function AccountModal({ queryString, onClose, onCreated }: { queryString: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [stage, setStage] = useState<string>("PROSPECT");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/crm/accounts${queryString}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, domain: domain.trim() || undefined, industry: industry.trim() || undefined, lifecycleStage: stage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not create the account."));
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the account.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New account" onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Name<input required value={name} onChange={(e) => setName(e.target.value)} style={inp} /></label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Domain<input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" style={inp} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Industry<input value={industry} onChange={(e) => setIndustry(e.target.value)} style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Stage<select value={stage} onChange={(e) => setStage(e.target.value)} style={inp}>{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        </div>
        {error && <p role="alert" style={{ color: "#b91c1c", margin: 0, fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, #4f46e5)", color: "white", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Creating…" : "Create account"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ContactModal({ accounts, queryString, onClose, onCreated }: { accounts: CrmAccount[]; queryString: string; onClose: () => void; onCreated: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/crm/contacts${queryString}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email: email.trim() || undefined, phone: phone.trim() || undefined, title: title.trim() || undefined, accountId: accountId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not create the contact."));
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the contact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New contact" onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Full name<input required value={fullName} onChange={(e) => setFullName(e.target.value)} style={inp} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@acme.com" style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} style={inp} /></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Title<input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Account<select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={inp}><option value="">— none —</option>{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}</select></label>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "var(--ink-500, #64748b)" }}>A contact needs an email, a phone, or an account.</p>
        {error && <p role="alert" style={{ color: "#b91c1c", margin: 0, fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, #4f46e5)", color: "white", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Creating…" : "Create contact"}</button>
        </div>
      </form>
    </Modal>
  );
}

function LeadModal({ accounts, queryString, onClose, onCreated }: { accounts: CrmAccount[]; queryString: string; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [stage, setStage] = useState<string>("NEW");
  const [source, setSource] = useState("");
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const trimmed = amount.trim();
      const amountMinorUnits = trimmed === "" ? undefined : Math.round(Number(trimmed) * 100);
      if (amountMinorUnits !== undefined && (!Number.isInteger(amountMinorUnits) || amountMinorUnits < 0)) {
        throw new Error("Enter a non-negative amount, or leave it blank.");
      }
      const res = await fetch(`/api/crm/leads${queryString}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, amountMinorUnits, currency, stage, source: source.trim() || undefined, accountId: accountId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not create the lead."));
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the lead.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New lead" onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Title<input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enterprise expansion" style={inp} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Amount<input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50000" inputMode="decimal" style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Currency<input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Stage<select value={stage} onChange={(e) => setStage(e.target.value)} style={inp}>{LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Source<input value={source} onChange={(e) => setSource(e.target.value)} placeholder="inbound, referral…" style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Account<select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={inp}><option value="">— none —</option>{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}</select></label>
        </div>
        {error && <p role="alert" style={{ color: "#b91c1c", margin: 0, fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, #4f46e5)", color: "white", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Creating…" : "Create lead"}</button>
        </div>
      </form>
    </Modal>
  );
}

function CaseModal({ accounts, queryString, onClose, onCreated }: { accounts: CrmAccount[]; queryString: string; onClose: () => void; onCreated: () => void }) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("NORMAL");
  const [blueprintKey, setBlueprintKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/crm/cases${queryString}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, description: description.trim() || undefined, priority, blueprintKey: blueprintKey.trim() || undefined, accountId: accountId || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not create the case."));
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the case.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New case" onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Subject<input required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Customer can't log in" style={inp} /></label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...inp, resize: "vertical" }} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Priority<select value={priority} onChange={(e) => setPriority(e.target.value)} style={inp}>{CASE_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Account<select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={inp}><option value="">— none —</option>{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}</select></label>
        </div>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Workflow blueprint (optional)<input value={blueprintKey} onChange={(e) => setBlueprintKey(e.target.value)} placeholder="support.case" style={inp} /><span style={{ fontSize: 11, color: "var(--ink-500, #64748b)" }}>The Decision Fabric blueprint that will govern this case's lifecycle.</span></label>
        {error && <p role="alert" style={{ color: "#b91c1c", margin: 0, fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, #4f46e5)", color: "white", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Creating…" : "Create case"}</button>
        </div>
      </form>
    </Modal>
  );
}
