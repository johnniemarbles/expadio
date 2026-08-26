"use client";

import { useEffect, useState } from "react";
import type { TemplateDetailRecord } from "../../api/communications/templates/[key]/route";

interface TemplatePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerKey: string;
}

export function TemplatePreviewModal({ isOpen, onClose, triggerKey }: TemplatePreviewModalProps) {
  const [template, setTemplate] = useState<TemplateDetailRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [previewMode, setPreviewMode] = useState<"rendered" | "source">("rendered");

  useEffect(() => {
    if (!isOpen || !triggerKey) return;
    setLoading(true);
    fetch(`/api/communications/templates/${encodeURIComponent(triggerKey)}`)
      .then((res) => res.json())
      .then((data) => {
        setTemplate(data);
        if (data.defaultVariables) {
          const vars: Record<string, string> = {};
          Object.entries(data.defaultVariables).forEach(([k, v]) => {
            vars[k] = String(v);
          });
          setVariables(vars);
        }
      })
      .catch((err) => console.error("Error loading template details:", err))
      .finally(() => setLoading(false));
  }, [isOpen, triggerKey]);

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
          background: "var(--surface, #ffffff)",
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
            <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 800, color: "var(--brand, #4f46e5)" }}>
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
        ) : template ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: "24px" }}>
            {/* Left Preview Window */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink-700, #334155)" }}>
                  Subject: <span style={{ fontWeight: 500 }}>{template.subject || "—"}</span>
                </div>
                <div style={{ display: "inline-flex", background: "#f1f5f9", borderRadius: "6px", padding: "2px" }}>
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
                      background: previewMode === "rendered" ? "white" : "transparent",
                      color: previewMode === "rendered" ? "var(--ink-900, #0f172a)" : "var(--ink-500, #64748b)",
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
                      background: previewMode === "source" ? "white" : "transparent",
                      color: previewMode === "source" ? "var(--ink-900, #0f172a)" : "var(--ink-500, #64748b)",
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
                  color: previewMode === "rendered" ? "#0f172a" : "#f8fafc",
                  fontFamily: previewMode === "source" ? "monospace" : "inherit",
                  fontSize: previewMode === "source" ? "12px" : "14px",
                  whiteSpace: previewMode === "source" ? "pre-wrap" : "normal",
                }}
              >
                {previewMode === "rendered" ? (
                  template.contentFormat === "HTML" ? (
                    <div dangerouslySetInnerHTML={{ __html: getRenderedContent(template.body) }} />
                  ) : (
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{getRenderedContent(template.body)}</div>
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
                      <label style={{ display: "block", fontSize: "11px", fontFamily: "monospace", color: "var(--brand, #4f46e5)", marginBottom: "4px" }}>
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
                <div style={{ fontSize: "11px", color: "var(--ink-500, #64748b)", marginTop: "4px" }}>Status: <strong style={{ color: "#16a34a" }}>{template.status}</strong></div>
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
