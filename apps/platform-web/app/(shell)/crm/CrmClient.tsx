"use client";

import { useState, useEffect } from "react";
import type { CrmAccount, CrmContact } from "@expadio/party";
import type { CrmLead, LeadStage } from "@expadio/lead";
import type { CrmCase, CaseStatus } from "@expadio/case";
import type { CrmAgreement, AgreementStatus } from "@expadio/agreement";
import type { CrmVocabulary, CaseWorkflowVocabulary, CaseSchema, CaseField, CaseOntology, IndustryPackCapabilities } from "@expadio/industry-packs";
import { apiError } from "../../../lib/api-error";

type ContactRow = CrmContact & { accountName: string | null };
type LeadRow = CrmLead & { accountName: string | null };
type CaseRow = CrmCase & { accountName: string | null; attributes?: Record<string, string> };
type AgreementRow = CrmAgreement & { accountName: string | null };

const AGREEMENT_STATUSES: AgreementStatus[] = ["DRAFT", "ACTIVE", "EXPIRED", "CANCELLED"];
const AGREEMENT_TONE: Record<string, { fg: string; bg: string }> = {
  DRAFT: { fg: "#475569", bg: "#f1f5f9" },
  ACTIVE: { fg: "#166534", bg: "#dcfce7" },
  EXPIRED: { fg: "#925b0b", bg: "#fef3c7" },
  CANCELLED: { fg: "#991b1b", bg: "#fee2e2" },
};

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
  initialAgreements: AgreementRow[];
  vocab: CrmVocabulary;
  caseVocab: CaseWorkflowVocabulary;
  caseSchema: CaseSchema;
  caseOntology: CaseOntology;
  verticalKey: string | null;
  verticalLabel: string | null;
  packChoices: readonly { verticalKey: string; label: string }[];
  packCatalog: readonly IndustryPackCapabilities[];
  queryString?: string;
}

const inp: React.CSSProperties = {
  width: "100%", padding: "8px 12px", border: "1px solid var(--line, #cbd5e1)", borderRadius: 8, fontSize: 13, outline: "none",
};

export function CrmClient({ initialAccounts, initialContacts, initialLeads, initialCases, initialAgreements, vocab, caseVocab, caseSchema, caseOntology, verticalKey, verticalLabel, packChoices, packCatalog, queryString = "" }: CrmClientProps) {
  const lc = (s: string) => s.toLowerCase();
  // Display a canonical stage key in the active vertical's process language,
  // falling back to the raw key when a pack does not relabel it.
  const stageLabel = (k: string | null | undefined): string =>
    (k && (caseVocab.stages as Record<string, string>)[k]) || k || "—";
  // A canonical decision outcome in the pack's language (APPROVE → "Approve
  // treatment plan"); the recorded outcome stays canonical underneath.
  const outcomeLabel = (o: string): string =>
    (caseVocab.decisionOutcomeLabels as Record<string, string> | undefined)?.[o] ?? o;
  // The pack's domain note for a canonical stage, if any.
  const stageGuidance = (k: string | null | undefined): string | undefined =>
    (k && (caseVocab.stageGuidance as Record<string, string> | undefined)?.[k]) || undefined;
  const [tab, setTab] = useState<"accounts" | "contacts" | "leads" | "cases" | "agreements">("accounts");
  const [accounts, setAccounts] = useState<CrmAccount[]>(initialAccounts);
  const [contacts, setContacts] = useState<ContactRow[]>(initialContacts);
  const [leads, setLeads] = useState<LeadRow[]>(initialLeads);
  const [cases, setCases] = useState<CaseRow[]>(initialCases);
  const [agreements, setAgreements] = useState<AgreementRow[]>(initialAgreements);
  const [showAccount, setShowAccount] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showLead, setShowLead] = useState(false);
  const [showCase, setShowCase] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [movingLead, setMovingLead] = useState<string | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [movingCase, setMovingCase] = useState<string | null>(null);
  type WfStage = { stageKey: string; label: string; sequence: number; decisionRequired: boolean; decisionOutcomes: string[]; requiredParticipantKeys: string[] };
  type WfAssignment = { stageKey: string; participantKey: string; status: string };
  type WorkflowState = { instanceId: string; currentStageKey: string | null; revision: number; state: string; stages: WfStage[]; currentDecision: { outcome: string } | null; assignments: WfAssignment[] };
  const [workflows, setWorkflows] = useState<Record<string, WorkflowState>>({});
  const [wfBusy, setWfBusy] = useState<string | null>(null);
  const [wfError, setWfError] = useState<string | null>(null);
  const [wfAuthHint, setWfAuthHint] = useState(false);
  const [traceCase, setTraceCase] = useState<CaseRow | null>(null);
  const [agreementError, setAgreementError] = useState<string | null>(null);
  const [movingAgreement, setMovingAgreement] = useState<string | null>(null);
  const [convertTarget, setConvertTarget] = useState<LeadRow | null>(null);
  const [switchingVertical, setSwitchingVertical] = useState(false);
  const [verticalError, setVerticalError] = useState<string | null>(null);

  async function changeVertical(next: string) {
    setSwitchingVertical(true); setVerticalError(null);
    try {
      const res = await fetch(`/api/tenancy/vertical${queryString}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verticalKey: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not change the industry pack."));
      // Vocabulary is resolved on the server, so re-run the page to re-skin.
      window.location.reload();
    } catch (cause) {
      setVerticalError(cause instanceof Error ? cause.message : "Could not change the industry pack.");
      setSwitchingVertical(false);
    }
  }

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
  // Conversion touches all three entities (lead → account (+case)); refresh them
  // together and drop the user on the tab that shows the new customer's work.
  function onConverted(openedCase: boolean) {
    setConvertTarget(null);
    reloadAccounts(); reloadLeads(); reloadCases();
    setTab(openedCase ? "cases" : "accounts");
  }

  async function reloadAgreements() {
    const res = await fetch(`/api/crm/agreements${queryString}`);
    if (res.ok) { const d = await res.json(); if (Array.isArray(d)) setAgreements(d); }
  }
  async function moveAgreement(agreementId: string, status: AgreementStatus) {
    setMovingAgreement(agreementId); setAgreementError(null);
    try {
      const res = await fetch(`/api/crm/agreements/${encodeURIComponent(agreementId)}${queryString}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not update the agreement."));
      setAgreements((prev) => prev.map((g) => (g.agreementId === agreementId ? { ...g, status } : g)));
    } catch (cause) {
      setAgreementError(cause instanceof Error ? cause.message : "Could not update the agreement.");
    } finally {
      setMovingAgreement(null);
    }
  }
  async function linkCaseAccount(caseId: string, accountId: string) {
    setCaseError(null);
    try {
      const res = await fetch(`/api/crm/cases/${encodeURIComponent(caseId)}${queryString}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not link the account."));
      const name = accounts.find((a) => a.accountId === accountId)?.name ?? null;
      setCases((prev) => prev.map((c) => (c.caseId === caseId ? { ...c, accountId, accountName: name } : c)));
    } catch (cause) {
      setCaseError(cause instanceof Error ? cause.message : "Could not link the account.");
    }
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

  const wfUrl = (caseId: string) => `/api/crm/cases/${encodeURIComponent(caseId)}/workflow${queryString}`;
  async function startCaseWorkflow(caseId: string) {
    setWfBusy(caseId); setWfError(null);
    try {
      const res = await fetch(wfUrl(caseId), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not start the workflow."));
      setWorkflows((prev) => ({ ...prev, [caseId]: { instanceId: data.instance.instanceId, currentStageKey: data.instance.currentStageKey ?? null, revision: data.instance.revision, state: data.instance.state, stages: data.stages ?? [], currentDecision: null, assignments: [] } }));
      setCases((prev) => prev.map((c) => (c.caseId === caseId ? { ...c, workflowInstanceId: data.instance.instanceId, stageKey: data.instance.currentStageKey ?? null } : c)));
    } catch (cause) {
      setWfError(cause instanceof Error ? cause.message : "Could not start the workflow.");
    } finally { setWfBusy(null); }
  }
  async function loadCaseWorkflow(caseId: string) {
    setWfBusy(caseId); setWfError(null);
    try {
      const res = await fetch(wfUrl(caseId));
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not load the workflow."));
      if (data.instance) {
        setWorkflows((prev) => ({ ...prev, [caseId]: { instanceId: data.instance.instanceId, currentStageKey: data.instance.currentStageKey ?? null, revision: data.instance.revision, state: data.instance.state, stages: data.stages ?? [], currentDecision: data.currentDecision ? { outcome: data.currentDecision.outcome } : null, assignments: data.assignments ?? [] } }));
      }
    } catch (cause) {
      setWfError(cause instanceof Error ? cause.message : "Could not load the workflow.");
    } finally { setWfBusy(null); }
  }
  async function advanceCase(caseId: string, toStageKey: string) {
    const wf = workflows[caseId];
    if (!wf) return;
    setWfBusy(caseId); setWfError(null);
    try {
      const res = await fetch(wfUrl(caseId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toStageKey, expectedRevision: wf.revision }) });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not advance the workflow."));
      // New stage → its own decision starts empty.
      setWorkflows((prev) => ({ ...prev, [caseId]: { ...prev[caseId], currentStageKey: data.instance.currentStageKey ?? null, revision: data.instance.revision, state: data.instance.state, currentDecision: null } }));
      setCases((prev) => prev.map((c) => (c.caseId === caseId ? { ...c, stageKey: data.instance.currentStageKey ?? null } : c)));
    } catch (cause) {
      setWfError(cause instanceof Error ? cause.message : "Could not advance the workflow.");
    } finally { setWfBusy(null); }
  }
  async function assignMe(caseId: string, stageKey: string, participantKey: string) {
    setWfBusy(caseId); setWfError(null);
    try {
      const res = await fetch(`/api/crm/cases/${encodeURIComponent(caseId)}/workflow/participants${queryString}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stageKey, participantKey, targetKind: "USER" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not assign the participant."));
      setWorkflows((prev) => {
        const wf = prev[caseId];
        if (!wf) return prev;
        const rest = wf.assignments.filter((a) => !(a.stageKey === stageKey && a.participantKey === participantKey));
        return { ...prev, [caseId]: { ...wf, assignments: [...rest, { stageKey, participantKey, status: "ASSIGNED" }] } };
      });
    } catch (cause) {
      setWfError(cause instanceof Error ? cause.message : "Could not assign the participant.");
    } finally { setWfBusy(null); }
  }
  async function decideCase(caseId: string, outcome: string) {
    setWfBusy(caseId); setWfError(null); setWfAuthHint(false);
    try {
      const res = await fetch(`/api/crm/cases/${encodeURIComponent(caseId)}/workflow/decision${queryString}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome }),
      });
      const data = await res.json();
      if (!res.ok) {
        // A monetary/role authority denial is fixable from the Approval Authority page.
        if (typeof data?.code === "string" && data.code.startsWith("WORKFLOW_AUTHORITY")) setWfAuthHint(true);
        throw new Error(apiError(data, "Could not record the decision."));
      }
      setWorkflows((prev) => ({ ...prev, [caseId]: { ...prev[caseId], currentDecision: { outcome: data.outcome ?? outcome } } }));
    } catch (cause) {
      setWfError(cause instanceof Error ? cause.message : "Could not record the decision.");
    } finally { setWfBusy(null); }
  }

  const openCases = cases.filter((c) => c.status === "OPEN" || c.status === "PENDING").length;
  const openPipelineMinor = leads.filter((l) => l.stage !== "WON" && l.stage !== "LOST").reduce((s, l) => s + (l.amountMinorUnits ?? 0), 0);
  const wonMinor = leads.filter((l) => l.stage === "WON").reduce((s, l) => s + (l.amountMinorUnits ?? 0), 0);
  const pipeCurrency = leads[0]?.currency ?? agreements[0]?.currency ?? "USD";
  const activeContractMinor = agreements.filter((g) => g.status === "ACTIVE").reduce((s, g) => s + (g.valueMinorUnits ?? 0), 0);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--ink-500, #64748b)" }}>Business engine / CRM{verticalLabel ? ` · ${verticalLabel}` : ""}</div>
          <h1 style={{ margin: "4px 0 0", fontSize: 24 }}>Customer relationships</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--ink-600, #475569)" }}>{vocab.account.plural} and {lc(vocab.contact.plural)} for this workspace, isolated by tenant.</p>
        </div>
        <div style={{ display: "grid", gap: 8, justifyItems: "end" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--ink-600, #475569)" }}>
            Industry pack
            <select
              value={verticalKey ?? ""}
              disabled={switchingVertical}
              onChange={(e) => changeVertical(e.target.value)}
              aria-label="Industry pack"
              style={{ fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", fontWeight: 700 }}
            >
              <option value="">Neutral engine</option>
              {packChoices.map((c) => <option key={c.verticalKey} value={c.verticalKey}>{c.label}</option>)}
            </select>
          </label>
          {packCatalog.length > 0 && (
            <details style={{ fontSize: 12, color: "var(--ink-600, #475569)", maxWidth: 340 }}>
              <summary style={{ cursor: "pointer", color: "var(--ink-500, #64748b)" }}>What each pack configures</summary>
              <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                {packCatalog.map((p) => (
                  <div key={p.verticalKey} style={{ border: `1px solid ${p.verticalKey === verticalKey ? "var(--brand, #4f46e5)" : "var(--line, #e2e8f0)"}`, borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontWeight: 800 }}>{p.label}{p.verticalKey === verticalKey ? " · active" : ""}</div>
                    <div style={{ marginTop: 2 }}><span style={{ color: "var(--ink-500, #64748b)" }}>Entities:</span> {p.entities.account} · {p.entities.contact} · {p.entities.lead} · {p.entities.case} · {p.entities.agreement}</div>
                    <div><span style={{ color: "var(--ink-500, #64748b)" }}>{p.workType}:</span> {p.stages.map((s) => s.label).join(" → ")}</div>
                    <div><span style={{ color: "var(--ink-500, #64748b)" }}>Fields (v{p.caseSchemaVersion}):</span> {p.caseFields.length > 0 ? p.caseFields.map((f) => f.label + (f.required ? "*" : "")).join(", ") : "—"}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setShowAccount(true)} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, #4f46e5)", color: "white", fontWeight: 700, cursor: "pointer" }}>+ New {lc(vocab.account.singular)}</button>
            <button type="button" onClick={() => setShowContact(true)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", fontWeight: 700, cursor: "pointer" }}>+ New {lc(vocab.contact.singular)}</button>
            <button type="button" onClick={() => setShowLead(true)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", fontWeight: 700, cursor: "pointer" }}>+ New {lc(vocab.lead.singular)}</button>
            <button type="button" onClick={() => setShowCase(true)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", fontWeight: 700, cursor: "pointer" }}>+ New {lc(vocab.case.singular)}</button>
            <button type="button" onClick={() => setShowAgreement(true)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", fontWeight: 700, cursor: "pointer" }}>+ New {lc(vocab.agreement.singular)}</button>
          </div>
          {verticalError && <div role="alert" style={{ fontSize: 12, color: "#b91c1c" }}>⚠️ {verticalError}</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <Stat label={vocab.account.plural} value={accounts.length} />
        <Stat label="Open pipeline" value={money(openPipelineMinor, pipeCurrency)} />
        <Stat label="Won" value={money(wonMinor, pipeCurrency)} />
        <Stat label={`Open ${lc(vocab.case.plural)}`} value={openCases} />
        <Stat label={`Active ${lc(vocab.agreement.plural)}`} value={money(activeContractMinor, pipeCurrency)} />
      </div>

      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--line, #e2e8f0)" }}>
        {(["accounts", "contacts", "leads", "cases", "agreements"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} style={{ padding: "8px 14px", border: 0, background: "transparent", cursor: "pointer", fontWeight: 700, fontSize: 14, color: tab === t ? "var(--brand, #4f46e5)" : "var(--ink-500, #64748b)", borderBottom: tab === t ? "2px solid var(--brand, #4f46e5)" : "2px solid transparent" }}>
            {t === "accounts" ? vocab.account.plural : t === "contacts" ? vocab.contact.plural : t === "leads" ? vocab.lead.plural : t === "cases" ? vocab.case.plural : vocab.agreement.plural}
          </button>
        ))}
      </div>

      {tab === "accounts" ? (
        <Panel>
          {accounts.length > 0 ? (
            <Table head={[vocab.account.singular, "Domain", "Industry", "Stage", "Created"]}>
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
            <Empty title={`No ${lc(vocab.account.plural)} yet`} desc={`Create your first ${lc(vocab.account.singular)} to start building the pipeline.`} />
          )}
        </Panel>
      ) : tab === "contacts" ? (
        <Panel>
          {contacts.length > 0 ? (
            <Table head={[vocab.contact.singular, "Email", "Phone", "Title", vocab.account.singular]}>
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
            <Empty title={`No ${lc(vocab.contact.plural)} yet`} desc={`Add people and optionally attach them to a ${lc(vocab.account.singular)}.`} />
          )}
        </Panel>
      ) : tab === "leads" ? (
        <Panel>
          {leadError && <div role="alert" style={{ fontSize: 12, color: "#b91c1c", padding: "0 8px 8px" }}>⚠️ {leadError}</div>}
          {leads.length > 0 ? (
            <Table head={[vocab.lead.singular, vocab.account.singular, "Amount", "Source", "Stage", ""]}>
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
                      <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        {l.stage !== "WON" && l.stage !== "LOST" && (
                          <button
                            type="button"
                            onClick={() => setConvertTarget(l)}
                            title={`Close-won this ${lc(vocab.lead.singular)} and turn it into a customer ${lc(vocab.account.singular)}`}
                            style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: 0, background: "#166534", color: "white", fontWeight: 700, cursor: "pointer" }}
                          >
                            Convert →
                          </button>
                        )}
                        <select
                          value={l.stage}
                          disabled={movingLead === l.leadId}
                          onChange={(e) => moveLead(l.leadId, e.target.value as LeadStage)}
                          aria-label={`Move ${l.title}`}
                          style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line, #cbd5e1)" }}
                        >
                          {LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty title={`No ${lc(vocab.lead.plural)} yet`} desc={`Create a ${lc(vocab.lead.singular)} to start tracking the pipeline. Move it through stages as it progresses.`} />
          )}
        </Panel>
      ) : tab === "cases" ? (
        <Panel>
          {caseError && <div role="alert" style={{ fontSize: 12, color: "#b91c1c", padding: "0 8px 8px" }}>⚠️ {caseError}</div>}
          {wfError && (
            <div role="alert" style={{ fontSize: 12, color: "#b91c1c", padding: "0 8px 8px" }}>
              ⚠️ {wfError}
              {wfAuthHint && <> · <a href={`/authority${queryString}`} style={{ color: "#0f766e", fontWeight: 700 }}>Grant approval authority →</a></>}
            </div>
          )}
          {cases.length > 0 ? (
            <Table head={[vocab.case.singular, vocab.account.singular, "Priority", "Blueprint", "Workflow", "Status", ""]}>
              {cases.map((c) => {
                const tone = CASE_STATUS_TONE[c.status] ?? CASE_STATUS_TONE.OPEN;
                return (
                  <tr key={c.caseId} style={{ borderTop: "1px solid var(--line, #f1f5f9)" }}>
                    <td style={td}>
                      <strong>{c.subject}</strong>
                      <CaseAttrChips fields={caseSchema.fields} attributes={c.attributes} />
                    </td>
                    <td style={td}>
                      {c.accountName ? c.accountName : (
                        <select
                          value=""
                          onChange={(e) => { if (e.target.value) linkCaseAccount(c.caseId, e.target.value); }}
                          aria-label={`Link an account to ${c.subject}`}
                          title="Link this case to an account (required before it can be resolved)"
                          style={{ fontSize: 12, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--line, #cbd5e1)", color: "var(--ink-500, #64748b)" }}
                        >
                          <option value="">Link account…</option>
                          {accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td style={td}><span style={{ fontWeight: 700, color: PRIORITY_TONE[c.priority] ?? "#475569" }}>{c.priority}</span></td>
                    <td style={td}>{c.blueprintKey ? <code style={{ fontSize: 11 }}>{c.blueprintKey}</code> : <span style={{ color: "var(--ink-500, #64748b)" }}>—</span>}</td>
                    <td style={td}><WorkflowCell c={c} wf={workflows[c.caseId]} stageLabel={stageLabel} outcomeLabel={outcomeLabel} stageGuidance={stageGuidance} busy={wfBusy === c.caseId} onStart={() => startCaseWorkflow(c.caseId)} onLoad={() => loadCaseWorkflow(c.caseId)} onAdvance={(stage) => advanceCase(c.caseId, stage)} onDecide={(outcome) => decideCase(c.caseId, outcome)} onAssign={(stageKey, pk) => assignMe(c.caseId, stageKey, pk)} onTrace={() => setTraceCase(c)} /></td>
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
            <Empty title={`No ${lc(vocab.case.plural)} yet`} desc={`Open a ${lc(vocab.case.singular)} to track a unit of work. Link it to the workflow blueprint that will govern it.`} />
          )}
        </Panel>
      ) : (
        <Panel>
          {agreementError && <div role="alert" style={{ fontSize: 12, color: "#b91c1c", padding: "0 8px 8px" }}>⚠️ {agreementError}</div>}
          {agreements.length > 0 ? (
            <Table head={[vocab.agreement.singular, vocab.account.singular, "Value", "Term", "Status", ""]}>
              {agreements.map((g) => {
                const tone = AGREEMENT_TONE[g.status] ?? AGREEMENT_TONE.DRAFT;
                const term = g.startsOn || g.endsOn ? `${g.startsOn ?? "…"} → ${g.endsOn ?? "…"}` : "—";
                return (
                  <tr key={g.agreementId} style={{ borderTop: "1px solid var(--line, #f1f5f9)" }}>
                    <td style={td}><strong>{g.title}</strong></td>
                    <td style={td}>{g.accountName ?? "—"}</td>
                    <td style={td}>{money(g.valueMinorUnits, g.currency)}</td>
                    <td style={td}>{term}</td>
                    <td style={td}><span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: tone.fg, background: tone.bg }}>{g.status}</span></td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <select
                        value={g.status}
                        disabled={movingAgreement === g.agreementId}
                        onChange={(e) => moveAgreement(g.agreementId, e.target.value as AgreementStatus)}
                        aria-label={`Update ${g.title}`}
                        style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line, #cbd5e1)" }}
                      >
                        {AGREEMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <Empty title={`No ${lc(vocab.agreement.plural)} yet`} desc={`Sign a ${lc(vocab.account.singular)} to a ${lc(vocab.agreement.singular)}. Convert a won ${lc(vocab.lead.singular)}, or add one directly against a ${lc(vocab.account.singular)}.`} />
          )}
        </Panel>
      )}

      {showAccount && (
        <AccountModal
          vocab={vocab}
          queryString={queryString}
          onClose={() => setShowAccount(false)}
          onCreated={() => { setShowAccount(false); reloadAccounts(); }}
        />
      )}
      {showContact && (
        <ContactModal
          accounts={accounts}
          vocab={vocab}
          queryString={queryString}
          onClose={() => setShowContact(false)}
          onCreated={() => { setShowContact(false); reloadContacts(); }}
        />
      )}
      {showLead && (
        <LeadModal
          accounts={accounts}
          vocab={vocab}
          queryString={queryString}
          onClose={() => setShowLead(false)}
          onCreated={() => { setShowLead(false); reloadLeads(); }}
        />
      )}
      {showCase && (
        <CaseModal
          accounts={accounts}
          vocab={vocab}
          fields={caseSchema.fields}
          queryString={queryString}
          onClose={() => setShowCase(false)}
          onCreated={() => { setShowCase(false); reloadCases(); }}
        />
      )}
      {traceCase && (
        <CaseTraceModal caseRow={traceCase} fields={caseSchema.fields} ontology={caseOntology} queryString={queryString} onClose={() => setTraceCase(null)} />
      )}
      {convertTarget && (
        <ConvertModal
          lead={convertTarget}
          vocab={vocab}
          queryString={queryString}
          onClose={() => setConvertTarget(null)}
          onConverted={onConverted}
        />
      )}
      {showAgreement && (
        <AgreementModal
          accounts={accounts}
          vocab={vocab}
          queryString={queryString}
          onClose={() => setShowAgreement(false)}
          onCreated={() => { setShowAgreement(false); reloadAgreements(); }}
        />
      )}
    </div>
  );
}

function WorkflowCell({ c, wf, stageLabel, outcomeLabel, stageGuidance, busy, onStart, onLoad, onAdvance, onDecide, onAssign, onTrace }: {
  c: CaseRow;
  wf?: { instanceId: string; currentStageKey: string | null; revision: number; state: string; stages: { stageKey: string; label: string; sequence: number; decisionRequired: boolean; decisionOutcomes: string[]; requiredParticipantKeys: string[] }[]; currentDecision: { outcome: string } | null; assignments: { stageKey: string; participantKey: string; status: string }[] };
  stageLabel: (k: string | null | undefined) => string;
  outcomeLabel: (o: string) => string;
  stageGuidance: (k: string | null | undefined) => string | undefined;
  busy: boolean;
  onStart: () => void;
  onLoad: () => void;
  onAdvance: (stageKey: string) => void;
  onDecide: (outcome: string) => void;
  onAssign: (stageKey: string, participantKey: string) => void;
  onTrace: () => void;
}) {
  const btn: React.CSSProperties = { fontSize: 12, padding: "4px 10px", borderRadius: 6, border: 0, background: "var(--brand, #4f46e5)", color: "white", fontWeight: 700, cursor: busy ? "not-allowed" : "pointer" };
  const traceBtn = (
    <button type="button" onClick={onTrace} title="View this case's governed workflow trace" style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--line, #cbd5e1)", background: "transparent", color: "var(--ink-600, #475569)", fontWeight: 700, cursor: "pointer" }}>Trace</button>
  );
  if (!c.workflowInstanceId) {
    if (c.blueprintKey) {
      return <button type="button" disabled={busy} onClick={onStart} style={btn} title="Start a governed Decision Fabric workflow for this case">{busy ? "Starting…" : "Start workflow"}</button>;
    }
    return <span style={{ fontSize: 11, color: "var(--ink-500, #64748b)" }}>Set a blueprint</span>;
  }
  const stage = wf?.currentStageKey ?? c.stageKey ?? "—";
  if (!wf) {
    return (
      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <button type="button" disabled={busy} onClick={onLoad} style={{ ...btn, background: "transparent", color: "var(--brand, #4f46e5)", border: "1px solid var(--line, #cbd5e1)" }} title="Load the workflow's stages">
          {busy ? "Loading…" : `Stage: ${stageLabel(stage)} ▾`}
        </button>
        {traceBtn}
      </div>
    );
  }
  if (wf.state === "COMPLETED") {
    return (
      <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: "#166534", background: "#dcfce7" }} title={`Completed at ${stage} · revision ${wf.revision}`}>✓ Completed · {stageLabel(stage)}</span>
        {traceBtn}
      </div>
    );
  }
  const cur = wf.stages.find((s) => s.stageKey === wf.currentStageKey);
  const gated = cur?.decisionRequired === true && wf.currentDecision === null;
  const isAssigned = (stageKey: string, pk: string) => wf.assignments.some((a) => a.stageKey === stageKey && a.participantKey === pk && a.status === "ASSIGNED");
  const unmet = wf.stages.flatMap((s) => s.requiredParticipantKeys.filter((pk) => !isAssigned(s.stageKey, pk)).map((pk) => ({ stageKey: s.stageKey, label: s.label, participantKey: pk })));
  return (
    <div style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: "#3730a3", background: "#e0e7ff" }} title={[`${stage} · revision ${wf.revision}`, stageGuidance(stage)].filter(Boolean).join(" — ")}>{stageLabel(stage)}</span>
      {unmet.length > 0 && (
        <select
          value=""
          disabled={busy}
          onChange={(e) => { const v = e.target.value; if (v) { const [sk, pk] = v.split("::"); onAssign(sk, pk); } }}
          aria-label="Assign a required participant"
          title="A stage requires a participant before it can be entered. Assign yourself to a slot."
          style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #c2410c", color: "#c2410c", fontWeight: 700 }}
        >
          <option value="">Assign…</option>
          {unmet.map((u) => <option key={`${u.stageKey}::${u.participantKey}`} value={`${u.stageKey}::${u.participantKey}`}>Me → {stageLabel(u.stageKey)}: {u.participantKey}</option>)}
        </select>
      )}
      {wf.currentDecision && (
        <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: "#166534", background: "#dcfce7" }} title={`Recorded decision (immutable) · ${wf.currentDecision.outcome}`}>✓ {outcomeLabel(wf.currentDecision.outcome)}</span>
      )}
      {gated ? (
        <select
          value=""
          disabled={busy}
          onChange={(e) => { if (e.target.value) onDecide(e.target.value); }}
          aria-label={`Record decision for ${c.subject}`}
          title="This stage is gated — record a decision to unlock advancing. Four-eyes: whoever advanced the case into this stage cannot approve it."
          style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #c2410c", color: "#c2410c", fontWeight: 700 }}
        >
          <option value="">Decide…</option>
          {(cur?.decisionOutcomes ?? []).map((o) => <option key={o} value={o}>{outcomeLabel(o)}</option>)}
        </select>
      ) : (
        <select
          value=""
          disabled={busy}
          onChange={(e) => { if (e.target.value) onAdvance(e.target.value); }}
          aria-label={`Advance ${c.subject}`}
          style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line, #cbd5e1)" }}
        >
          <option value="">Advance to…</option>
          {wf.stages.filter((s) => s.stageKey !== wf.currentStageKey).map((s) => <option key={s.stageKey} value={s.stageKey}>{stageLabel(s.stageKey)}</option>)}
        </select>
      )}
      {traceBtn}
    </div>
  );
}

// The pack's declared case fields, shown inline in the list as compact chips —
// so a Treatment shows its urgency and a Matter its type without opening the
// trace. Only fields the case carries a value for render; none on the neutral
// engine, so the chips are simply absent.
function CaseAttrChips({ fields, attributes }: { fields: readonly CaseField[]; attributes?: Record<string, string> }) {
  const attrs = attributes ?? {};
  const filled = fields.filter((f) => (attrs[f.key] ?? "").trim() !== "");
  if (filled.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
      {filled.map((f) => (
        <span key={f.key} title={f.label} style={{ display: "inline-flex", gap: 4, fontSize: 10, padding: "1px 6px", borderRadius: 999, background: "var(--surface-2, #f1f5f9)", color: "var(--ink-600, #475569)" }}>
          <span style={{ color: "var(--ink-500, #64748b)" }}>{f.label}:</span>
          <span style={{ fontWeight: 700 }}>{attrs[f.key]}</span>
        </span>
      ))}
    </div>
  );
}

function CaseTraceModal({ caseRow, fields, ontology, queryString, onClose }: { caseRow: CaseRow; fields: readonly CaseField[]; ontology: CaseOntology; queryString: string; onClose: () => void }) {
  // The pack's declared domain fields that this case actually carries a value for.
  const attrs = caseRow.attributes ?? {};
  const filledFields = fields.filter((f) => (attrs[f.key] ?? "").trim() !== "");
  type Entry =
    | { kind: "TRANSITION"; at: string; revision: number; fromStageKey: string | null; toStageKey: string; bySubjectId: string; reason: string | null }
    | { kind: "DECISION"; at: string; stageKey: string; outcome: string; bySubjectId: string; code: string; evidenceRefs?: string[] };
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/crm/cases/${encodeURIComponent(caseRow.caseId)}/workflow/history${queryString}`);
        const data = await res.json();
        if (!res.ok) throw new Error(apiError(data, "Could not load the trace."));
        if (live) setEntries(Array.isArray(data.entries) ? data.entries : []);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : "Could not load the trace.");
      }
    })();
    return () => { live = false; };
  }, [caseRow.caseId, queryString]);

  return (
    <Modal title={`Workflow trace — ${caseRow.subject}`} onClose={onClose}>
      <details style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 10, padding: "8px 12px" }}>
        <summary style={{ cursor: "pointer", fontSize: 12, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-500, #64748b)" }}>
          Domain model — {ontology.entity}
        </summary>
        <div style={{ display: "grid", gap: 8, marginTop: 8, fontSize: 13 }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--ink-500, #64748b)", marginBottom: 2 }}>Relates to</div>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {ontology.relationships.map((r) => (
                <li key={r.conceptKey} title={r.conceptKey}><span style={{ color: "var(--ink-500, #64748b)" }}>{r.role}:</span> <strong>{r.entityLabel}</strong></li>
              ))}
            </ul>
          </div>
          {ontology.fields.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: "var(--ink-500, #64748b)", marginBottom: 2 }}>Domain fields</div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {ontology.fields.map((f) => (
                  <li key={f.key}><strong>{f.label}</strong> <span style={{ color: "var(--ink-500, #64748b)" }}>· {f.type}{f.required ? " · required" : ""}</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
      {filledFields.length > 0 && (
        <div style={{ display: "grid", gap: 6, border: "1px solid var(--line, #e2e8f0)", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ink-500, #64748b)" }}>Details</div>
          <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", margin: 0, fontSize: 13 }}>
            {filledFields.map((f) => (
              <div key={f.key} style={{ display: "contents" }}>
                <dt style={{ color: "var(--ink-500, #64748b)" }}>{f.label}</dt>
                <dd style={{ margin: 0, fontWeight: 600 }}>{attrs[f.key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <p style={{ margin: 0, fontSize: 12, color: "var(--ink-500, #64748b)" }}>Append-only transitions and immutable decisions, in order. This is the governed audit trail.</p>
      {error && <p role="alert" style={{ color: "#b91c1c", margin: 0, fontSize: 13 }}>{error}</p>}
      {entries === null && !error && <p style={{ fontSize: 13, color: "var(--ink-500, #64748b)" }}>Loading…</p>}
      {entries !== null && entries.length === 0 && <Empty title="No trace yet" desc="Start the workflow and advance it to build a history." />}
      {entries !== null && entries.length > 0 && (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8, maxHeight: 360, overflowY: "auto" }}>
          {entries.map((e, i) => (
            <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", borderLeft: `3px solid ${e.kind === "DECISION" ? "#166534" : "#4f46e5"}`, paddingLeft: 10 }}>
              <span style={{ fontSize: 10, color: "var(--ink-500, #64748b)", minWidth: 132 }}>{new Date(e.at).toLocaleString()}</span>
              <span style={{ fontSize: 13 }}>
                {e.kind === "TRANSITION" ? (
                  <>
                    <strong>{e.fromStageKey ?? "—"}</strong> → <strong>{e.toStageKey}</strong>
                    <span style={{ fontSize: 11, color: "var(--ink-500, #64748b)" }}> · rev {e.revision} · {e.bySubjectId}{e.reason ? ` · “${e.reason}”` : ""}</span>
                  </>
                ) : (
                  <>
                    <span style={{ padding: "1px 6px", borderRadius: 999, fontSize: 10, fontWeight: 800, color: "#166534", background: "#dcfce7" }}>DECISION</span>{" "}
                    <strong>{e.outcome}</strong> on <strong>{e.stageKey}</strong>
                    <span style={{ fontSize: 11, color: "var(--ink-500, #64748b)" }}> · {e.bySubjectId}</span>
                    {e.evidenceRefs && e.evidenceRefs.length > 0 && (
                      <span style={{ display: "block", marginTop: 2 }}>
                        {e.evidenceRefs.map((ref) => (
                          <code key={ref} style={{ fontSize: 10, color: "var(--ink-500, #64748b)", background: "var(--surface-2, #f1f5f9)", padding: "1px 5px", borderRadius: 4, marginRight: 4 }}>{ref}</code>
                        ))}
                      </span>
                    )}
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Close</button>
      </div>
    </Modal>
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

function AccountModal({ vocab, queryString, onClose, onCreated }: { vocab: CrmVocabulary; queryString: string; onClose: () => void; onCreated: () => void }) {
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
    <Modal title={`New ${vocab.account.singular.toLowerCase()}`} onClose={onClose}>
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
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, #4f46e5)", color: "white", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Creating…" : `Create ${vocab.account.singular.toLowerCase()}`}</button>
        </div>
      </form>
    </Modal>
  );
}

function ContactModal({ accounts, vocab, queryString, onClose, onCreated }: { accounts: CrmAccount[]; vocab: CrmVocabulary; queryString: string; onClose: () => void; onCreated: () => void }) {
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
    <Modal title={`New ${vocab.contact.singular.toLowerCase()}`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Full name<input required value={fullName} onChange={(e) => setFullName(e.target.value)} style={inp} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Email<input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@acme.com" style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} style={inp} /></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Title<input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>{vocab.account.singular}<select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={inp}><option value="">— none —</option>{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}</select></label>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "var(--ink-500, #64748b)" }}>A {vocab.contact.singular.toLowerCase()} needs an email, a phone, or a {vocab.account.singular.toLowerCase()}.</p>
        {error && <p role="alert" style={{ color: "#b91c1c", margin: 0, fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, #4f46e5)", color: "white", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Creating…" : `Create ${vocab.contact.singular.toLowerCase()}`}</button>
        </div>
      </form>
    </Modal>
  );
}

function LeadModal({ accounts, vocab, queryString, onClose, onCreated }: { accounts: CrmAccount[]; vocab: CrmVocabulary; queryString: string; onClose: () => void; onCreated: () => void }) {
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
    <Modal title={`New ${vocab.lead.singular.toLowerCase()}`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Title<input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enterprise expansion" style={inp} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Amount<input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50000" inputMode="decimal" style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Currency<input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Stage<select value={stage} onChange={(e) => setStage(e.target.value)} style={inp}>{LEAD_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Source<input value={source} onChange={(e) => setSource(e.target.value)} placeholder="inbound, referral…" style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>{vocab.account.singular}<select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={inp}><option value="">— none —</option>{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}</select></label>
        </div>
        {error && <p role="alert" style={{ color: "#b91c1c", margin: 0, fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, #4f46e5)", color: "white", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Creating…" : `Create ${vocab.lead.singular.toLowerCase()}`}</button>
        </div>
      </form>
    </Modal>
  );
}

function AgreementModal({ accounts, vocab, queryString, onClose, onCreated }: { accounts: CrmAccount[]; vocab: CrmVocabulary; queryString: string; onClose: () => void; onCreated: () => void }) {
  const [accountId, setAccountId] = useState("");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [status, setStatus] = useState<string>("DRAFT");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      if (!accountId) throw new Error(`Choose the ${vocab.account.singular.toLowerCase()} this ${vocab.agreement.singular.toLowerCase()} is with.`);
      const trimmed = value.trim();
      const valueMinorUnits = trimmed === "" ? undefined : Math.round(Number(trimmed) * 100);
      if (valueMinorUnits !== undefined && (!Number.isInteger(valueMinorUnits) || valueMinorUnits < 0)) {
        throw new Error("Enter a non-negative value, or leave it blank.");
      }
      const res = await fetch(`/api/crm/agreements${queryString}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, title, valueMinorUnits, currency, status, startsOn: startsOn || undefined, endsOn: endsOn || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not create the agreement."));
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the agreement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`New ${vocab.agreement.singular.toLowerCase()}`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>{vocab.account.singular}<select required value={accountId} onChange={(e) => setAccountId(e.target.value)} style={inp}><option value="">— choose a {vocab.account.singular.toLowerCase()} —</option>{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}</select></label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Title<input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Annual subscription" style={inp} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Value<input value={value} onChange={(e) => setValue(e.target.value)} placeholder="120000" inputMode="decimal" style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Currency<input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Status<select value={status} onChange={(e) => setStatus(e.target.value)} style={inp}>{AGREEMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Starts<input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Ends<input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} style={inp} /></label>
        </div>
        {error && <p role="alert" style={{ color: "#b91c1c", margin: 0, fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, #4f46e5)", color: "white", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Creating…" : `Create ${vocab.agreement.singular.toLowerCase()}`}</button>
        </div>
      </form>
    </Modal>
  );
}

function ConvertModal({ lead, vocab, queryString, onClose, onConverted }: { lead: LeadRow; vocab: CrmVocabulary; queryString: string; onClose: () => void; onConverted: (openedCase: boolean) => void }) {
  const [openCase, setOpenCase] = useState(true);
  const [caseSubject, setCaseSubject] = useState(`Onboarding — ${lead.accountName ?? lead.title}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/crm/leads/${encodeURIComponent(lead.leadId)}/convert${queryString}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openCase, caseSubject: openCase ? caseSubject.trim() || undefined : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not convert the lead."));
      onConverted(openCase);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not convert the lead.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Convert to customer" onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-600, #475569)" }}>
          Closes <strong>{lead.title}</strong> as won and {lead.accountId ? `promotes its ${vocab.account.singular.toLowerCase()} to ` : `creates a new ${vocab.account.singular.toLowerCase()} at the `}
          <span style={{ fontWeight: 700, color: "#166534" }}>CUSTOMER</span> stage.
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={openCase} onChange={(e) => setOpenCase(e.target.checked)} />
          Open an onboarding {vocab.case.singular.toLowerCase()} for the new customer
        </label>
        {openCase && (
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>{vocab.case.singular} subject<input value={caseSubject} onChange={(e) => setCaseSubject(e.target.value)} style={inp} /></label>
        )}
        {error && <p role="alert" style={{ color: "#b91c1c", margin: 0, fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#166534", color: "white", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Converting…" : "Convert to customer"}</button>
        </div>
      </form>
    </Modal>
  );
}

function CaseModal({ accounts, vocab, fields, queryString, onClose, onCreated }: { accounts: CrmAccount[]; vocab: CrmVocabulary; fields: readonly CaseField[]; queryString: string; onClose: () => void; onCreated: () => void }) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string>("NORMAL");
  const [blueprintKey, setBlueprintKey] = useState("");
  const [accountId, setAccountId] = useState("");
  // Pack-declared domain fields (empty on the neutral engine).
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAttr = (key: string, value: string) => setAttrs((prev) => ({ ...prev, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/crm/cases${queryString}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, description: description.trim() || undefined, priority, blueprintKey: blueprintKey.trim() || undefined, accountId: accountId || undefined, attributes: attrs }),
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
    <Modal title={`New ${vocab.case.singular.toLowerCase()}`} onClose={onClose}>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Subject<input required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Customer can't log in" style={inp} /></label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...inp, resize: "vertical" }} /></label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Priority<select value={priority} onChange={(e) => setPriority(e.target.value)} style={inp}>{CASE_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>{vocab.account.singular}<select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={inp}><option value="">— none —</option>{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}</select></label>
        </div>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Workflow blueprint (optional)<input value={blueprintKey} onChange={(e) => setBlueprintKey(e.target.value)} placeholder="support.case" style={inp} /><span style={{ fontSize: 11, color: "var(--ink-500, #64748b)" }}>The Decision Fabric blueprint that will govern this case's lifecycle.</span></label>
        {fields.length > 0 && (
          <div style={{ display: "grid", gap: 12, paddingTop: 4, borderTop: "1px solid var(--line, #e2e8f0)" }}>
            {fields.map((f) => (
              <label key={f.key} style={{ display: "grid", gap: 4, fontSize: 12 }}>
                {f.label}{f.required ? <span style={{ color: "#b91c1c" }}> *</span> : null}
                {f.type === "select" ? (
                  <select required={f.required} value={attrs[f.key] ?? ""} onChange={(e) => setAttr(f.key, e.target.value)} style={inp}>
                    <option value="">— select —</option>
                    {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input required={f.required} type={f.type === "number" ? "number" : "text"} value={attrs[f.key] ?? ""} onChange={(e) => setAttr(f.key, e.target.value)} style={inp} />
                )}
              </label>
            ))}
          </div>
        )}
        {error && <p role="alert" style={{ color: "#b91c1c", margin: 0, fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, #4f46e5)", color: "white", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Creating…" : `Create ${vocab.case.singular.toLowerCase()}`}</button>
        </div>
      </form>
    </Modal>
  );
}
