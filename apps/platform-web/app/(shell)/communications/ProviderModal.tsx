"use client";

import { useMemo, useState } from "react";

type ProviderModalProps = { isOpen: boolean; onClose: () => void; onCreated: () => void };
type Provider = readonly [string, string, string];

const providers: readonly Provider[] = [
  ["ses", "email", "AWS SES"], ["sendgrid", "email", "SendGrid"], ["resend", "email", "Resend"],
  ["postmark", "email", "Postmark"], ["mailgun", "email", "Mailgun"], ["twilio-sms", "sms", "Twilio SMS"],
  ["twilio-whatsapp", "whatsapp", "Twilio WhatsApp"], ["twilio-voice", "voice", "Twilio Voice"],
  ["vonage-sms", "sms", "Vonage SMS"], ["vonage-voice", "voice", "Vonage Voice"],
] as const;

function b64u(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function wrapCredential(secret: string) {
  const keyResponse = await fetch(`/api/custody/wrapping-key${window.location.search}`, { cache: "no-store" });
  const key = await keyResponse.json();
  if (!keyResponse.ok) throw new Error(key.error || "Unable to start secure credential intake.");
  const publicKey = await crypto.subtle.importKey("jwk", key.publicJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, ephemeral.privateKey, 256);
  const label = new TextEncoder().encode("ECDH-ES+A256GCM");
  const kdf = new Uint8Array(4 + shared.byteLength + label.byteLength);
  new DataView(kdf.buffer).setUint32(0, 1); kdf.set(new Uint8Array(shared), 4); kdf.set(label, 4 + shared.byteLength);
  const rawAesKey = await crypto.subtle.digest("SHA-256", kdf);
  const aesKey = await crypto.subtle.importKey("raw", rawAesKey, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, aesKey, new TextEncoder().encode(secret)));
  const tag = encrypted.slice(-16); const ciphertext = encrypted.slice(0, -16);
  const epk = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  return { kid: key.kid, epk: b64u(epk), iv: b64u(iv), ct: b64u(ciphertext), tag: b64u(tag) };
}

export function ProviderModal({ isOpen, onClose, onCreated }: ProviderModalProps) {
  const [providerKey, setProviderKey] = useState(providers[0][0]);
  const [connectorKey, setConnectorKey] = useState("");
  const [region, setRegion] = useState("");
  const [priority, setPriority] = useState("100");
  const [secret, setSecret] = useState("");
  const [accountSid, setAccountSid] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [domain, setDomain] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [failurePolicy, setFailurePolicy] = useState("HOLD_AND_RETRY");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => providers.find((item) => item[0] === providerKey) ?? providers[0], [providerKey]);
  const providerType = selected[1]; const providerLabel = selected[2];

  if (!isOpen) return null;
  function reset() {
    setConnectorKey(""); setRegion(""); setPriority("100"); setSecret(""); setAccountSid(""); setAccessKeyId(""); setApiKey("");
    setDomain(""); setFromAddress(""); setFromNumber(""); setFailurePolicy("HOLD_AND_RETRY"); setStatus(null); setError(null);
  }
  function close() { if (!saving) { reset(); onClose(); } }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!secret.trim()) { setError("Enter the provider credential."); return; }
    if (providerKey === "ses" && (!accessKeyId.trim() || !region.trim())) { setError("AWS SES requires both an access key ID and region."); return; }
    if (providerKey.startsWith("vonage") && !apiKey.trim()) { setError("Vonage requires the API key as well as the API secret."); return; }
    if (providerKey.startsWith("twilio") && !accountSid.trim()) { setError("Twilio requires the account SID."); return; }
    setSaving(true); setError(null); setStatus("Creating a one-time secure intake key…");
    const connector = connectorKey.trim() || `comm-${providerKey}-${crypto.randomUUID()}`;
    try {
      const parameters: Record<string, string> = {};
      if (accountSid.trim()) parameters.accountSid = accountSid.trim();
      if (accessKeyId.trim()) parameters.accessKeyId = accessKeyId.trim();
      if (apiKey.trim()) parameters.apiKey = apiKey.trim();
      if (region.trim()) parameters.region = region.trim();
      if (domain.trim()) parameters.domain = domain.trim();
      if (fromAddress.trim()) parameters.fromAddress = fromAddress.trim();
      if (fromNumber.trim()) parameters.fromNumber = fromNumber.trim();

      setStatus("Encrypting credential locally…");
      const envelope = await wrapCredential(secret); setSecret("");
      setStatus(`Probing ${providerLabel}; invalid credentials are not saved…`);
      const custodyResponse = await fetch(`/api/custody/credentials${window.location.search}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ connectorKey: connector, providerKey, envelope, parameters }),
      });
      const custody = await custodyResponse.json();
      if (!custodyResponse.ok) throw new Error(custody.error || "Credential intake failed.");
      if (custody.probeStatus !== "VALID" || !custody.credentialRef) throw new Error("The credential could not be verified; no provider was registered.");
      if (!Array.isArray(custody.detectedCapabilities) || custody.detectedCapabilities.length === 0) throw new Error("The credential was valid, but the provider reported no usable communication capability.");

      setStatus("Registering the verified connector…");
      const registrationResponse = await fetch(`/api/communications/providers${window.location.search}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey, providerType, connectorKey: connector, region: region.trim() || undefined, priority: Number(priority),
          credentialRef: custody.credentialRef, capabilityKeys: custody.detectedCapabilities, failurePolicy, custodyMode: "DELEGATED",
          fingerprint: custody.fingerprint, keyVersion: custody.keyVersion, detectedCapabilities: custody.detectedCapabilities, probeWarnings: custody.warnings }),
      });
      const registration = await registrationResponse.json();
      if (!registrationResponse.ok) throw new Error(registration.error || "Provider registration failed.");
      setStatus("Provider registered. It remains disabled until explicitly activated."); onCreated(); window.setTimeout(close, 500);
    } catch (cause) { setStatus(null); setError(cause instanceof Error ? cause.message : "Provider registration failed."); }
    finally { setSaving(false); }
  }

  return (
    <div role="presentation" onClick={close} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(15,23,42,.6)", display: "grid", placeItems: "center", padding: 20 }}>
      <form onSubmit={submit} onClick={(event) => event.stopPropagation()} style={{ width: "min(620px,100%)", maxHeight: "90vh", overflow: "auto", background: "white", borderRadius: 16, padding: 28, display: "grid", gap: 14 }}>
        <div><p style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "#475569" }}>Platform Communications</p><h2 style={{ margin: "4px 0 0" }}>Add provider</h2><p style={{ margin: "6px 0 0", color: "#64748b", fontSize: 13 }}>Credentials are encrypted in this browser, verified, then stored as a vault reference. Invalid credentials are not saved.</p></div>
        <label>Provider<select value={providerKey} onChange={(event) => setProviderKey(event.target.value)}>{providers.map(([key,,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Channel<input value={providerType} readOnly /></label>
        <label>Connector key<input value={connectorKey} onChange={(event) => setConnectorKey(event.target.value)} placeholder="Optional stable key" /></label>
        <label>Region<input value={region} onChange={(event) => setRegion(event.target.value)} placeholder={providerKey === "ses" ? "us-east-1 (required for SES)" : "Optional region"} /></label>
        <label>Priority<input type="number" min="0" value={priority} onChange={(event) => setPriority(event.target.value)} /></label>
        {providerKey === "ses" && <label>AWS access key ID<input value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} placeholder="Non-secret access key identifier" /></label>}
        {providerKey.startsWith("twilio") && <label>Twilio account SID<input value={accountSid} onChange={(event) => setAccountSid(event.target.value)} placeholder="Non-secret account identifier" /></label>}
        {providerKey.startsWith("vonage") && <label>Vonage API key<input value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Non-secret API key" /></label>}
        {providerType === "email" && <label>Sending domain<input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="mail.example.com" /></label>}
        {providerType === "email" && <label>From address<input type="email" value={fromAddress} onChange={(event) => setFromAddress(event.target.value)} placeholder="notifications@example.com" /></label>}
        {(providerType === "sms" || providerType === "whatsapp" || providerType === "voice") && <label>From number<input value={fromNumber} onChange={(event) => setFromNumber(event.target.value)} placeholder="E.164 sender number" /></label>}
        <label>Provider credential<input required type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Credential / API secret" /></label>
        <label>Failure policy<select value={failurePolicy} onChange={(event) => setFailurePolicy(event.target.value)}><option value="HOLD_AND_RETRY">Hold and retry</option><option value="FALLBACK_TRANSACTIONAL">Fallback transactional</option><option value="REFUSE_IMMEDIATELY">Refuse immediately</option></select></label>
        {status && <p style={{ color: "#334155", margin: 0, fontSize: 13 }} aria-live="polite">{status}</p>}{error && <p role="alert" style={{ color: "#b91c1c", margin: 0 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}><button type="button" onClick={close} disabled={saving}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Setting up…" : "Verify & add provider"}</button></div>
      </form>
    </div>
  );
}
