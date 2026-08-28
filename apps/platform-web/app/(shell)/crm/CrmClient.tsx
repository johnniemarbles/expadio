"use client";

import { useState } from "react";
import type { CrmAccount, CrmContact } from "@expadio/party";
import { apiError } from "../../../lib/api-error";

type ContactRow = CrmContact & { accountName: string | null };

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
  queryString?: string;
}

const inp: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line, #cbd5e1)", borderRadius: 8, fontSize: 13, outline: "none",
};

export function CrmClient({ initialAccounts, initialContacts, queryString = "" }: CrmClientProps) {
  const [tab, setTab] = useState<"accounts" | "contacts">("accounts");
  const [accounts, setAccounts] = useState<CrmAccount[]>(initialAccounts);
  const [contacts, setContacts] = useState<ContactRow[]>(initialContacts);
  const [showAccount, setShowAccount] = useState(false);
  const [showContact, setShowContact] = useState(false);

  async function reloadAccounts() {
    const res = await fetch(`/api/crm/accounts${queryString}`);
    if (res.ok) { const d = await res.json(); if (Array.isArray(d)) setAccounts(d); }
  }
  async function reloadContacts() {
    const res = await fetch(`/api/crm/contacts${queryString}`);
    if (res.ok) { const d = await res.json(); if (Array.isArray(d)) setContacts(d); }
  }

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
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <Stat label="Accounts" value={accounts.length} />
        <Stat label="Customers" value={accounts.filter((a) => a.lifecycleStage === "CUSTOMER").length} />
        <Stat label="Open opportunities" value={accounts.filter((a) => a.lifecycleStage === "OPPORTUNITY" || a.lifecycleStage === "LEAD").length} />
        <Stat label="Contacts" value={contacts.length} />
      </div>

      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--line, #e2e8f0)" }}>
        {(["accounts", "contacts"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} style={{ padding: "8px 14px", border: 0, background: "transparent", cursor: "pointer", fontWeight: 700, fontSize: 14, color: tab === t ? "var(--brand, #4f46e5)" : "var(--ink-500, #64748b)", borderBottom: tab === t ? "2px solid var(--brand, #4f46e5)" : "2px solid transparent" }}>
            {t === "accounts" ? "Accounts" : "Contacts"}
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
      ) : (
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
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
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
