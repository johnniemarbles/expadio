"use client";

import { useCallback, useEffect, useState } from "react";
import type { TemplateDetailRecord } from "../../api/communications/templates/[key]/route";
import { apiError } from "../../../lib/api-error";

interface TemplatePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerKey: string;
  onChanged?: () => void;
}

export function TemplatePreviewModal({ isOpen, onClose, triggerKey, onChanged }: TemplatePreviewModalProps) {
  const [template, setTemplate] = useState<TemplateDetailRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [previewMode, setPreviewMode] = useState<"rendered" | "source">("rendered");
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ subject: string; title: string; body: string; contentFormat: string; requiredVariables: string }>(
    { subject: "", title: "", body: "", contentFormat: "HTML", requiredVariables: "" },
  );

  const loadTemplate = useCallback(() => {
    if (!triggerKey) return;
    setLoading(true);
    setActionError(null);
    setActionNotice(null);
    setEditing(false);
    fetch(`/api/communications/templates/${encodeURIComponent(triggerKey)}${window.location.search}`)
      .then((res) => res.json())
      .then((data) => {
        setTemplate(data && data.templateId ? data : null);
        if (data && data.defaultVariables) {
          const vars: Record<string, string> = {};
          Object.entries(data.defaultVariables).forEach(([k, v]) => {
            vars[k] = String(v);
          });
          setVariables(vars);
        }
      })
      .catch((err) => console.error("Error loading template details:", err))
      .finally(() => setLoading(false));
  }, [triggerKey]);

  function startEditing() {
    if (!template) return;
    setDraft({
      subject: template.subject ?? "",
      title: template.title ?? "",
      body: template.body,
      contentFormat: template.contentFormat,
      requiredVariables: template.requiredVariables.join(", "),
    });
    setActionError(null);
    setActionNotice(null);
    setEditing(true);
  }

  async function saveDraft() {
    if (!template) return;
    setWorking(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/communications/templates/${encodeURIComponent(triggerKey)}${window.location.search}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: template.templateId,
          version: template.version,
          subject: draft.subject.trim() || null,
          title: draft.title.trim() || null,
          body: draft.body,
          contentFormat: draft.contentFormat,
          requiredVariables: draft.requiredVariables.split(",").map((v) => v.trim()).filter(Boolean),
          defaultVariables: template.defaultVariables,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not save the draft."));
      setActionNotice(`Draft v${template.version} saved.`);
      setEditing(false);
      loadTemplate();
      onChanged?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not save the draft.");
    } finally {
      setWorking(false);
    }
  }

  useEffect(() => {
    if (!isOpen || !triggerKey) return;
    loadTemplate();
  }, [isOpen, triggerKey, loadTemplate]);

  async function createDraftVersion() {
    if (!template) return;
    setWorking(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/communications/templates/${encodeURIComponent(triggerKey)}/versions${window.location.search}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.templateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not create a draft version."));
      setActionNotice(`Draft v${data.template?.version ?? ""} created. Edit it in the composer, then publish.`);
      loadTemplate();
      onChanged?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not create a draft version.");
    } finally {
      setWorking(false);
    }
  }

  async function cloneToBrand() {
    if (!template) return;
    setWorking(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/communications/templates/${encodeURIComponent(triggerKey)}/clone${window.location.search}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: template.channel, locale: template.locale }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not clone this template."));
      setActionNotice("Cloned into a brand draft. Find it in the catalogue as a TENANT template, then edit and publish.");
      onChanged?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not clone this template.");
    } finally {
      setWorking(false);
    }
  }

  async function publishVersion() {
    if (!template) return;
    setWorking(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/communications/templates/${encodeURIComponent(triggerKey)}/publish${window.location.search}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.templateId, version: template.version }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Could not publish this version."));
      setActionNotice(`Version ${template.version} is now ACTIVE.`);
      loadTemplate();
      onChanged?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not publish this version.");
    } finally {
      setWorking(false);
    }
  }

  if (!isOpen) return null;

  // Substitute variables into template body
  function getRenderedContent(rawBody: string) {
    let output = rawBody;
    Object.entries(variables).forEach(([k, v]) => {
      output = output.replaceAll(`{{${k}}}`, v);
    });
    return output;
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
          maxWidth: "840px",
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
              Template Inspector &amp; Live Variable Preview
            </span>
            <h2 style={{ margin: "4px 0 0", fontSize: "20px", fontWeight: 700 }}>
              {triggerKey}
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

        {loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--ink-500, #64748b)" }}>
            Loading template content and variable schema...
          </div>
        ) : template && editing ? (
          <div style={{ display: "grid", gap: "14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: "12px" }}>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Subject
                <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} style={{ padding: "8px 12px", border: "1px solid var(--line, #cbd5e1)", borderRadius: 8, fontSize: 13 }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Format
                <select value={draft.contentFormat} onChange={(e) => setDraft({ ...draft, contentFormat: e.target.value })} style={{ padding: "8px 12px", border: "1px solid var(--line, #cbd5e1)", borderRadius: 8, fontSize: 13 }}>
                  {["TEXT", "HTML", "MARKDOWN"].map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            </div>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Title
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ padding: "8px 12px", border: "1px solid var(--line, #cbd5e1)", borderRadius: 8, fontSize: 13 }} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Body
              <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={12} style={{ padding: "10px 12px", border: "1px solid var(--line, #cbd5e1)", borderRadius: 8, fontSize: 13, fontFamily: "monospace", resize: "vertical" }} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Required variables (comma-separated)
              <input value={draft.requiredVariables} onChange={(e) => setDraft({ ...draft, requiredVariables: e.target.value })} placeholder="name, code" style={{ padding: "8px 12px", border: "1px solid var(--line, #cbd5e1)", borderRadius: 8, fontSize: 13 }} />
            </label>
            {actionError && <div role="alert" style={{ fontSize: 12, color: "var(--theme-danger)" }}>⚠️ {actionError}</div>}
            {actionNotice && <div style={{ fontSize: 12, color: "var(--theme-success)" }}>✅ {actionNotice}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" onClick={() => setEditing(false)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Cancel</button>
              <button type="button" onClick={saveDraft} disabled={working} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, var(--theme-primary))", color: "var(--theme-text-inverse)", fontWeight: 700, cursor: working ? "not-allowed" : "pointer" }}>{working ? "Saving…" : "Save draft"}</button>
            </div>
          </div>
        ) : template ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "24px" }}>
            {/* Left Preview Window */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink-700, #334155)" }}>
                  Subject: <span style={{ fontWeight: 500 }}>{template.subject || "—"}</span>
                </div>
                <div style={{ display: "inline-flex", background: "var(--theme-surface-muted)", borderRadius: "6px", padding: "2px" }}>
                  <button
                    type="button"
                    onClick={() => setPreviewMode("rendered")}
                    style={{
                      border: 0,
                      padding: "4px 10px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      background: previewMode === "rendered" ? "var(--theme-text-inverse)" : "transparent",
                      color: previewMode === "rendered" ? "var(--ink-900, var(--theme-text-primary))" : "var(--ink-500, #64748b)",
                      boxShadow: previewMode === "rendered" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                    }}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode("source")}
                    style={{
                      border: 0,
                      padding: "4px 10px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      background: previewMode === "source" ? "var(--theme-text-inverse)" : "transparent",
                      color: previewMode === "source" ? "var(--ink-900, var(--theme-text-primary))" : "var(--ink-500, #64748b)",
                      boxShadow: previewMode === "source" ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                    }}
                  >
                    Source ({template.contentFormat})
                  </button>
                </div>
              </div>

              <div
                style={{
                  border: "1px solid var(--line, #e2e8f0)",
                  borderRadius: "10px",
                  minHeight: "260px",
                  maxHeight: "380px",
                  overflowY: "auto",
                  padding: "16px",
                  background: previewMode === "rendered" ? "#fafafa" : "#1e293b",
                  color: previewMode === "rendered" ? "var(--theme-text-primary)" : "#f8fafc",
                  fontFamily: previewMode === "source" ? "monospace" : "inherit",
                  fontSize: previewMode === "source" ? "12px" : "14px",
                  var(--theme-text-inverse)Space: previewMode === "source" ? "pre-wrap" : "normal",
                }}
              >
                {previewMode === "rendered" ? (
                  template.contentFormat === "HTML" ? (
                    <div dangerouslySetInnerHTML={{ __html: getRenderedContent(template.body) }} />
                  ) : (
                    <div style={{ var(--theme-text-inverse)Space: "pre-wrap", lineHeight: 1.6 }}>{getRenderedContent(template.body)}</div>
                  )
                ) : (
                  template.body
                )}
              </div>
            </div>

            {/* Right Variable Substitution Panel */}
            <div style={{ borderLeft: "1px solid var(--line, #e2e8f0)", paddingLeft: "20px" }}>
              <h4 style={{ margin: "0 0 12px", fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-500, #64748b)" }}>
                Variables
              </h4>
              {template.requiredVariables.length > 0 ? (
                <div style={{ display: "grid", gap: "12px" }}>
                  {template.requiredVariables.map((v) => (
                    <div key={v}>
                      <label style={{ display: "block", fontSize: "11px", fontFamily: "monospace", color: "var(--brand, var(--theme-primary))", marginBottom: "4px" }}>
                        {"{{" + v + "}}"}
                      </label>
                      <input
                        type="text"
                        value={variables[v] || ""}
                        onChange={(e) => setVariables({ ...variables, [v]: e.target.value })}
                        placeholder={`Enter ${v}`}
                        style={{
                          width: "100%",
                          padding: "6px 10px",
                          border: "1px solid var(--line, #cbd5e1)",
                          borderRadius: "6px",
                          fontSize: "12px",
                          outline: "none",
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ fontSize: "12px", color: "var(--ink-500, #64748b)" }}>No variable substitutions required for this template.</p>
              )}

              <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid var(--line, #e2e8f0)" }}>
                <div style={{ fontSize: "11px", color: "var(--ink-500, #64748b)" }}>Format: <strong>{template.contentFormat}</strong></div>
                <div style={{ fontSize: "11px", color: "var(--ink-500, #64748b)", marginTop: "4px" }}>Channel: <strong>{template.channel}</strong></div>
                <div style={{ fontSize: "11px", color: "var(--ink-500, #64748b)", marginTop: "4px" }}>Version: <strong>v{template.version}</strong></div>
                <div style={{ fontSize: "11px", color: "var(--ink-500, #64748b)", marginTop: "4px" }}>
                  Status: <strong style={{ color: template.status === "ACTIVE" ? "var(--theme-success)" : template.status === "DRAFT" ? "var(--theme-warning)" : "var(--theme-neutral)" }}>{template.status}</strong>
                </div>

                <div style={{ marginTop: "16px", display: "grid", gap: "8px" }}>
                  {template.status === "DRAFT" ? (
                    <button
                      type="button"
                      onClick={publishVersion}
                      disabled={working}
                      style={{ padding: "8px 12px", borderRadius: "8px", border: 0, background: "var(--theme-success)", color: "var(--theme-text-inverse)", fontWeight: 700, fontSize: "12px", cursor: working ? "not-allowed" : "pointer" }}
                    >
                      {working ? "Working…" : `Publish v${template.version}`}
                    </button>
                  ) : null}
                  {template.status === "DRAFT" && (
                    <button
                      type="button"
                      onClick={startEditing}
                      disabled={working}
                      style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--brand, var(--theme-primary))", background: "transparent", color: "var(--brand, var(--theme-primary))", fontWeight: 700, fontSize: "12px", cursor: working ? "not-allowed" : "pointer" }}
                    >
                      Edit draft
                    </button>
                  )}
                  {template.status !== "DRAFT" && (
                    <button
                      type="button"
                      onClick={createDraftVersion}
                      disabled={working}
                      style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--brand, var(--theme-primary))", background: "transparent", color: "var(--brand, var(--theme-primary))", fontWeight: 700, fontSize: "12px", cursor: working ? "not-allowed" : "pointer" }}
                    >
                      {working ? "Working…" : "Create new draft version"}
                    </button>
                  )}
                  {template.scope === "PLATFORM" && template.status === "ACTIVE" && (
                    <button
                      type="button"
                      onClick={cloneToBrand}
                      disabled={working}
                      style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--line, #cbd5e1)", background: "transparent", color: "var(--ink-700, #334155)", fontWeight: 700, fontSize: "12px", cursor: working ? "not-allowed" : "pointer" }}
                    >
                      {working ? "Working…" : "Clone to brand draft"}
                    </button>
                  )}
                  {actionError && <div role="alert" style={{ fontSize: "11px", color: "var(--theme-danger)" }}>⚠️ {actionError}</div>}
                  {actionNotice && <div style={{ fontSize: "11px", color: "var(--theme-success)" }}>✅ {actionNotice}</div>}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: "40px", textAlign: "center", color: "var(--ink-500, #64748b)" }}>
            Template could not be loaded.
          </div>
        )}
      </div>
    </div>
  );
}
