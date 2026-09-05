"use client";

import { useState } from "react";
import { apiError } from "../../../lib/api-error";
import motionStyles from "./TemplateComposerModal.module.css";

/**
 * Governed platform template creation (design §6, restored POST /templates).
 * A new template lands as DRAFT scope=PLATFORM. Authoring requires a
 * PLATFORM_SUPER_ADMIN / PLATFORM_ADMIN role — the API enforces it; a
 * non-admin sees the FORBIDDEN reason surfaced here rather than a silent no-op.
 */

interface TemplateComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  queryString?: string;
}

const CHANNELS = ["email", "sms", "whatsapp", "voice", "in_app", "push", "rcs"];
const FORMATS = ["TEXT", "HTML", "MARKDOWN"];

export function TemplateComposerModal({ isOpen, onClose, onCreated, queryString = "" }: TemplateComposerModalProps) {
  const [triggerKey, setTriggerKey] = useState("");
  const [channel, setChannel] = useState("email");
  const [contentFormat, setContentFormat] = useState("HTML");
  const [locale, setLocale] = useState("en");
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [requiredVariables, setRequiredVariables] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/communications/templates${queryString}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          triggerKey: triggerKey.trim(),
          channel,
          contentFormat,
          locale: locale.trim() || "en",
          subject: subject.trim() || null,
          title: title.trim() || null,
          body,
          requiredVariables: requiredVariables.split(",").map((v) => v.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiError(data, "Template creation failed."));
      onCreated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Template creation failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="presentation" onClick={onClose} className={motionStyles.backdrop} style={{ position: "fixed", inset: 0, zIndex: 125, background: "var(--theme-overlay)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className={`${motionStyles.dialog} ${motionStyles.formControls}`} style={{ width: "min(640px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "var(--theme-surface-raised)", borderRadius: "var(--theme-radius-card)", padding: 28, display: "grid", gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--theme-text-secondary)" }}>Platform communications</p>
          <h2 style={{ margin: "4px 0 0" }}>New template</h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--theme-text-muted)" }}>Created as a DRAFT. Publish it from the template inspector once it is ready.</p>
        </div>

        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Trigger key
          <input required value={triggerKey} onChange={(e) => setTriggerKey(e.target.value)} placeholder="identity.verification.code" style={inp} />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Channel
            <select value={channel} onChange={(e) => setChannel(e.target.value)} style={inp}>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Format
            <select value={contentFormat} onChange={(e) => setContentFormat(e.target.value)} style={inp}>{FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}</select>
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Locale
            <input value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="en" style={inp} />
          </label>
        </div>

        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Subject (email)
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Your verification code" style={inp} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={inp} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Body
          <textarea required value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder={"Hello {{name}}, your code is {{code}}."} style={{ ...inp, fontFamily: "monospace", resize: "vertical" }} />
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Required variables (comma-separated)
          <input value={requiredVariables} onChange={(e) => setRequiredVariables(e.target.value)} placeholder="name, code" style={inp} />
        </label>

        {error && <p role="alert" className={motionStyles.error} style={{ color: "var(--theme-danger)", margin: 0, fontSize: 13 }}>{error}</p>}
        <div className={motionStyles.actions} style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ padding: "8px 16px", borderRadius: "var(--theme-radius-card)", border: "1px solid var(--theme-border)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: "var(--theme-radius-card)", border: 0, background: "var(--theme-primary)", color: "var(--theme-text-inverse)", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Creating…" : "Create draft"}</button>
        </div>
      </form>
    </div>
  );
}

const inp: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--theme-border)",
  borderRadius: "var(--theme-radius-card)",
  fontSize: 13,
  outline: "none",
  width: "100%",
};