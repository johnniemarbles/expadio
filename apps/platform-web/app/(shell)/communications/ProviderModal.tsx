"use client";

import { useMemo, useState } from "react";
import { apiError } from "../../../lib/api-error";
import { wrapSecret, type PublishedWrappingKey } from "../../../lib/custody-wrap";
import motionStyles from "./ProviderModal.module.css";

type ProviderModalProps = { isOpen: boolean; onClose: () => void; onCreated: () => void };

/**
 * Provider registration is a governed, step-up-guarded flow (design §2–§3), not
 * a plain form:
 *   - CUSTOMER_EGRESS: register a connector with no stored secret (the customer
 *     sends via their own egress). No credential, no probe.
 *   - DELEGATED (BYOK): fetch a wrapping key, wrap the secret in the browser,
 *     POST /custody/credentials to probe + vault it, then register with the
 *     returned reference. The plaintext secret never leaves the tab in the clear.
 *
 * Every custody and provider call carries a fresh step-up header (§3.4).
 */

const PROVIDERS: readonly [string, string, string, string | null][] = [
  ["ses", "email", "AWS SES", "ses"],
  ["sendgrid", "email", "SendGrid", "sendgrid"],
  ["resend", "email", "Resend", "resend"],
  ["postmark", "email", "Postmark", "postmark"],
  ["mailgun", "email", "Mailgun", "mailgun"],
  ["smtp", "email", "SMTP", null],
  ["twilio-sms", "sms", "Twilio SMS", "twilio"],
  ["twilio-whatsapp", "whatsapp", "Twilio WhatsApp", "twilio"],
  ["twilio-voice", "voice", "Twilio Voice", "twilio"],
  ["vonage-sms", "sms", "Vonage SMS", "vonage"],
  ["vonage-voice", "voice", "Vonage Voice", "vonage"],
  ["messagebird-sms", "sms", "MessageBird SMS", null],
  ["messagebird-whatsapp", "whatsapp", "MessageBird WhatsApp", null],
  ["360dialog", "whatsapp", "360dialog WhatsApp", null],
];

const CHANNEL_CAPABILITY: Record<string, string> = {
  email: "communication.email.send",
  sms: "communication.sms.send",
  whatsapp: "communication.whatsapp.send",
  voice: "communication.voice.dial",
  push: "communication.push.send",
  rcs: "communication.rcs.send",
};

type CustodyMode = "CUSTOMER_EGRESS" | "DELEGATED";

function reauthHeaders(json = true): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    "x-expadio-reauth-at": new Date().toISOString(),
  };
}

export function ProviderModal({ isOpen, onClose, onCreated }: ProviderModalProps) {
  const [registerKey, setRegisterKey] = useState<string>(PROVIDERS[0][0]);
  const [connectorKey, setConnectorKey] = useState("");
  const [region, setRegion] = useState("");
  const [priority, setPriority] = useState("100");
  const [custodyMode, setCustodyMode] = useState<CustodyMode>("CUSTOMER_EGRESS");
  const [secret, setSecret] = useState("");
  const [accountSid, setAccountSid] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const selected = useMemo(() => PROVIDERS.find((p) => p[0] === registerKey) ?? PROVIDERS[0], [registerKey]);
  const channel = selected[1];
  const custodyBase = selected[3];
  const capabilityKey = CHANNEL_CAPABILITY[channel] ?? "communication.email.send";
  const byokAvailable = custodyBase !== null;

  if (!isOpen) return null;

  function reset() {
    setSecret(""); setAccountSid(""); setApiKey(""); setAccessKeyId(""); setFromAddress(""); setFromNumber("");
    setStatus(null); setError(null); setWarnings([]);
  }

  async function registerConnector(credentialRef: string | null, capabilityKeys: string[]) {
    const response = await fetch(`/api/communications/providers${window.location.search}`, {
      method: "POST",
      headers: reauthHeaders(),
      body: JSON.stringify({
        providerKey: registerKey,
        providerType: channel,
        connectorKey: connectorKey.trim() || undefined,
        region: region.trim() || undefined,
        priority: Number(priority) || 100,
        custodyMode,
        capabilityKeys,
        ...(credentialRef ? { credentialRef } : {}),
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(apiError(result, "Provider registration failed."));
  }

  async function runByokIntake(): Promise<{ reference: string; capabilities: string[] }> {
    if (custodyBase === null) throw new Error("BYOK intake is not available for this provider.");
    if (!secret.trim()) throw new Error("Enter the API secret or token to store.");
    const effectiveConnectorKey = connectorKey.trim() || `comm-${registerKey}-${crypto.randomUUID().slice(0, 8)}`;

    setStatus("Requesting a one-time wrapping key…");
    const keyRes = await fetch(`/api/custody/wrapping-key${window.location.search}`, { headers: reauthHeaders(false) });
    const keyBody = await keyRes.json();
    if (!keyRes.ok) throw new Error(apiError(keyBody, "Could not obtain a wrapping key."));

    setStatus("Wrapping the credential in your browser…");
    const envelope = await wrapSecret(keyBody as PublishedWrappingKey, secret);

    const parameters: Record<string, string> = {};
    if (accountSid.trim()) parameters.accountSid = accountSid.trim();
    if (apiKey.trim()) parameters.apiKey = apiKey.trim();
    if (accessKeyId.trim()) parameters.accessKeyId = accessKeyId.trim();
    if (region.trim()) parameters.region = region.trim();
    if (fromAddress.trim()) parameters.fromAddress = fromAddress.trim();
    if (fromNumber.trim()) parameters.fromNumber = fromNumber.trim();

    setStatus("Probing the credential with the provider…");
    const intakeRes = await fetch(`/api/custody/credentials${window.location.search}`, {
      method: "POST",
      headers: reauthHeaders(),
      body: JSON.stringify({ connectorKey: effectiveConnectorKey, providerKey: custodyBase, envelope, parameters }),
    });
    const intakeBody = await intakeRes.json();
    if (Array.isArray(intakeBody?.warnings) && intakeBody.warnings.length > 0) {
      setWarnings(intakeBody.warnings.map((w: any) => (typeof w === "string" ? w : w.message)).filter(Boolean));
    }
    if (!intakeRes.ok) throw new Error(apiError(intakeBody, "The credential could not be verified."));

    if (!connectorKey.trim()) setConnectorKey(effectiveConnectorKey);
    return { reference: intakeBody.reference, capabilities: [capabilityKey] };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setWarnings([]);
    setStatus(null);
    try {
      if (custodyMode === "DELEGATED") {
        const { reference, capabilities } = await runByokIntake();
        setStatus("Registering the connector…");
        await registerConnector(reference, capabilities);
      } else {
        setStatus("Registering the connector…");
        await registerConnector(null, [capabilityKey]);
      }
      onCreated();
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Provider registration failed.");
      setStatus(null);
    } finally {
      setSaving(false);
    }
  }

  const field: React.CSSProperties = {
    width: "100%", padding: "8px 12px", border: "1px solid var(--theme-border)", borderRadius: 8, fontSize: 13, outline: "none",
  };

  return (
    <div role="presentation" onClick={onClose} className={motionStyles.backdrop} style={{ position: "fixed", inset: 0, zIndex: 120, background: "var(--theme-overlay)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className={motionStyles.dialog} style={{ width: "min(580px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "var(--theme-surface-raised)", borderRadius: 16, padding: 28, display: "grid", gap: 14 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--theme-text-secondary)" }}>Platform communications</p>
          <h2 style={{ margin: "4px 0 0" }}>Register provider</h2>
        </div>

        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Provider
          <select value={registerKey} onChange={(e) => { setRegisterKey(e.target.value); const p = PROVIDERS.find((x) => x[0] === e.target.value); if (p && p[3] === null) setCustodyMode("CUSTOMER_EGRESS"); }} style={field}>
            {PROVIDERS.map(([key, ch, label]) => <option key={key} value={key}>{label} · {ch}</option>)}
          </select>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Connector key
            <input value={connectorKey} onChange={(e) => setConnectorKey(e.target.value)} placeholder="Optional stable key" style={field} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Region
            <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" style={field} />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Priority
            <input type="number" min="0" value={priority} onChange={(e) => setPriority(e.target.value)} style={field} />
          </label>
          <div style={{ display: "grid", gap: 4, fontSize: 12 }}>Capability
            <div style={{ ...field, background: "var(--theme-surface-muted)", fontFamily: "monospace", fontSize: 12 }}>{capabilityKey}</div>
          </div>
        </div>

        <fieldset style={{ border: "1px solid var(--theme-border)", borderRadius: 10, padding: 12, margin: 0 }}>
          <legend style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--theme-text-secondary)", padding: "0 6px" }}>Credential custody</legend>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 8 }}>
            <input type="radio" name="custody" checked={custodyMode === "CUSTOMER_EGRESS"} onChange={() => setCustodyMode("CUSTOMER_EGRESS")} />
            <span><strong>Customer egress</strong> — register the connector with no stored secret. You send through your own infrastructure.</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, opacity: byokAvailable ? 1 : 0.5 }}>
            <input type="radio" name="custody" disabled={!byokAvailable} checked={custodyMode === "DELEGATED"} onChange={() => setCustodyMode("DELEGATED")} />
            <span><strong>Store a credential (BYOK)</strong> — wrap an API secret in your browser; we probe it and vault it. {byokAvailable ? "" : "Not available for this provider yet."}</span>
          </label>
        </fieldset>

        {custodyMode === "DELEGATED" && byokAvailable && (
          <div style={{ display: "grid", gap: 10, border: "1px dashed var(--theme-border)", borderRadius: 10, padding: 12 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>API secret / token
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Wrapped in your browser before it is sent" style={field} autoComplete="off" />
            </label>
            {custodyBase === "twilio" && <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Account SID<input value={accountSid} onChange={(e) => setAccountSid(e.target.value)} placeholder="ACxxxxxxxx" style={field} /></label>}
            {custodyBase === "ses" && <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Access key ID<input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} placeholder="AKIA…" style={field} /></label>}
            {custodyBase === "vonage" && <label style={{ display: "grid", gap: 4, fontSize: 12 }}>API key<input value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={field} /></label>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>From address<input value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="no-reply@brand.com" style={field} /></label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>From number<input value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} placeholder="+15551234567" style={field} /></label>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--theme-text-muted)" }}>The secret is ECDH-wrapped in your browser; only the sealed envelope is transmitted.</p>
          </div>
        )}

        {status && <p className={motionStyles.status} style={{ margin: 0, fontSize: 12, color: "var(--theme-primary)" }}>{status}</p>}
        {warnings.length > 0 && <div className={motionStyles.warning} style={{ fontSize: 12, color: "var(--theme-warning)", background: "color-mix(in srgb,var(--theme-warning) 12%,transparent)", padding: 10, borderRadius: 8 }}>{warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}</div>}
        {error && <p role="alert" className={motionStyles.error} style={{ color: "var(--theme-danger)", margin: 0, fontSize: 13 }}>{error}</p>}

        <div className={motionStyles.actions} style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={() => { reset(); onClose(); }} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--theme-border)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--theme-primary)", color: "var(--theme-text-inverse)", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Working…" : custodyMode === "DELEGATED" ? "Verify & register" : "Register provider"}
          </button>
        </div>
      </form>
    </div>
  );
}