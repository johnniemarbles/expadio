"use client";

import { useState } from "react";

type ProviderModalProps = { isOpen: boolean; onClose: () => void; onCreated: () => void };

const providers = [
  ["ses", "email", "AWS SES"],
  ["sendgrid", "email", "SendGrid"],
  ["resend", "email", "Resend"],
  ["postmark", "email", "Postmark"],
  ["mailgun", "email", "Mailgun"],
  ["smtp", "email", "SMTP"],
  ["twilio-sms", "sms", "Twilio SMS"],
  ["twilio-whatsapp", "whatsapp", "Twilio WhatsApp"],
  ["twilio-voice", "voice", "Twilio Voice"],
  ["vonage-sms", "sms", "Vonage SMS"],
  ["vonage-voice", "voice", "Vonage Voice"],
  ["messagebird-sms", "sms", "MessageBird SMS"],
  ["messagebird-whatsapp", "whatsapp", "MessageBird WhatsApp"],
  ["360dialog", "whatsapp", "360dialog WhatsApp"],
] as const;

export function ProviderModal({ isOpen, onClose, onCreated }: ProviderModalProps) {
  const [providerKey, setProviderKey] = useState(providers[0][0]);
  const [providerType, setProviderType] = useState(providers[0][1]);
  const [connectorKey, setConnectorKey] = useState("");
  const [region, setRegion] = useState("");
  const [priority, setPriority] = useState("100");
  const [credentialRef, setCredentialRef] = useState("");
  const [capabilityKeys, setCapabilityKeys] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/communications/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerKey,
          providerType,
          connectorKey: connectorKey.trim() || undefined,
          region: region.trim() || undefined,
          priority: Number(priority),
          credentialRef: credentialRef.trim(),
          capabilityKeys: capabilityKeys.split(",").map((value) => value.trim()).filter(Boolean),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Provider registration failed.");
      onCreated();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider registration failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="presentation" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(15,23,42,.6)", display: "grid", placeItems: "center", padding: 20 }}>
      <form onSubmit={submit} onClick={(event) => event.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "90vh", overflow: "auto", background: "white", borderRadius: 16, padding: 28, display: "grid", gap: 14 }}>
        <div><p style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#475569" }}>Platform Communications</p><h2 style={{ margin: "4px 0 0" }}>Register provider</h2></div>
        <label>Provider<select value={providerKey} onChange={(event) => { const next = providers.find((item) => item[0] === event.target.value)!; setProviderKey(next[0]); setProviderType(next[1]); }}><>{providers.map(([key, , label]) => <option key={key} value={key}>{label}</option>)}</></select></label>
        <label>Channel<select value={providerType} onChange={(event) => setProviderType(event.target.value)}>{["email", "sms", "whatsapp", "voice", "push", "rcs"].map((channel) => <option key={channel} value={channel}>{channel}</option>)}</select></label>
        <label>Connector key<input value={connectorKey} onChange={(event) => setConnectorKey(event.target.value)} placeholder="Optional stable key" /></label>
        <label>Region<input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="us-east-1" /></label>
        <label>Priority<input type="number" min="0" value={priority} onChange={(event) => setPriority(event.target.value)} /></label>
        <label>Secret reference<input required value={credentialRef} onChange={(event) => setCredentialRef(event.target.value)} placeholder="kms://communications/provider/production" /></label>
        <label>Capability keys<input required value={capabilityKeys} onChange={(event) => setCapabilityKeys(event.target.value)} placeholder="communication.email.send" /></label>
        {error && <p role="alert" style={{ color: "#b91c1c", margin: 0 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Registering…" : "Register provider"}</button></div>
      </form>
    </div>
  );
}
