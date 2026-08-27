"use client";

import { useState } from "react";
import type { TemplateCatalogueItem } from "../../api/communications/templates/route";
import { TemplatePreviewModal } from "./TemplatePreviewModal";

interface TemplateLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: TemplateCatalogueItem[];
}

export function TemplateLibraryModal({ isOpen, onClose, templates }: TemplateLibraryModalProps) {
  const [selectedTriggerKey, setSelectedTriggerKey] = useState<string | null>(null);
  const [cloneState, setCloneState] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  async function cloneTemplate(template: TemplateCatalogueItem) {
    const channel = template.channels[0];
    const locale = template.locales[0] || "en";
    if (!channel) return;
    setCloneState((current) => ({ ...current, [template.triggerKey]: "Cloning..." }));
    try {
      const response = await fetch(`/api/communications/templates/${encodeURIComponent(template.triggerKey)}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, locale }),
      });
      const data = await response.json().catch(() => ({}));
      setCloneState((current) => ({
        ...current,
        [template.triggerKey]: response.ok ? "Cloned to draft" : (data.error || "Clone failed"),
      }));
    } catch {
      setCloneState((current) => ({ ...current, [template.triggerKey]: "Clone failed" }));
    }
  }

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-library-title"
        style={{
          position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)",
          backdropFilter: "blur(6px)", display: "grid", placeItems: "center", zIndex: 100, padding: 20,
        }}
        onClick={onClose}
      >
        <div
          style={{ background: "var(--surface, #fff)", border: "1px solid var(--line, #e2e8f0)",
            borderRadius: 16, width: "100%", maxWidth: 980, maxHeight: "90vh", overflow: "auto", padding: 28,
            boxShadow: "0 25px 50px -12px rgba(0,0,0,.25)" }}
          onClick={(event) => event.stopPropagation()}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
            <div>
              <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em", fontWeight: 800, color: "var(--brand, #4f46e5)" }}>
                Communications / Templates
              </span>
              <h2 id="template-library-title" style={{ margin: "4px 0 0", fontSize: 22 }}>Email Template Library</h2>
              <p style={{ margin: "6px 0 0", color: "var(--ink-500, #64748b)", fontSize: 13 }}>
                Browse platform templates, inspect variables, and clone a platform version into a tenant draft.
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close template library" style={{ border: "1px solid var(--line, #e2e8f0)", background: "transparent", borderRadius: 8, width: 34, height: 34, cursor: "pointer" }}>✕</button>
          </div>

          {templates.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "var(--ink-500, #64748b)" }}>No platform templates are currently available.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {templates.map((template) => (
                <div key={`${template.scope}:${template.triggerKey}`} style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 10, padding: 16, display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 16, alignItems: "center" }}>
                  <div>
                    <strong style={{ fontSize: 14 }}>{template.triggerKey}</strong>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "#f1f5f9" }}>{template.scope}</span>
                      {template.channels.map((channel) => <span key={channel} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "#f1f5f9" }}>{channel}</span>)}
                      {template.locales.map((locale) => <span key={locale} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, background: "#f1f5f9" }}>{locale}</span>)}
                      <span style={{ fontSize: 11, color: "var(--ink-500, #64748b)" }}>{template.totalVersions} version{template.totalVersions === 1 ? "" : "s"} · {template.activeCount} active · {template.draftCount} draft</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {template.hasActiveVersion && (
                      <button type="button" onClick={() => setSelectedTriggerKey(template.triggerKey)} style={{ border: "1px solid var(--line, #cbd5e1)", background: "white", borderRadius: 999, padding: "7px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>Preview</button>
                    )}
                    {template.scope === "PLATFORM" && template.hasActiveVersion && (
                      <button type="button" onClick={() => cloneTemplate(template)} disabled={cloneState[template.triggerKey] === "Cloning..."} style={{ border: 0, background: "#0f172a", color: "white", borderRadius: 999, padding: "8px 13px", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                        {cloneState[template.triggerKey] || "Clone to tenant"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedTriggerKey && (
        <TemplatePreviewModal
          isOpen={Boolean(selectedTriggerKey)}
          onClose={() => setSelectedTriggerKey(null)}
          triggerKey={selectedTriggerKey}
        />
      )}
    </>
  );
}
