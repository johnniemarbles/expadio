"use client";

import { useMemo, useState } from "react";
import { apiError } from "../../../lib/api-error";
import { wrapSecret, type PublishedWrappingKey } from "../../../lib/custody-wrap";
import { EXECUTABLE_COMMUNICATION_PROVIDERS } from "../../../lib/communication-runtime-providers";

type ProviderModalProps = { isOpen: boolean; onClose: () => void; onCreated: () => void };

function reauthHeaders(json = true): HeadersInit {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    "x-expadio-reauth-at": new Date().toISOString(),
  };
}

export function ProviderModal({ isOpen, onClose, onCreated }: ProviderModalProps) {
  const [registerKey, setRegisterKey] = useState<string>(EXECUTABLE_COMMUNICATION_PROVIDERS[0].providerKey);
  const [connectorKey, setConnectorKey] = useState("");
  const [region, setRegion] = useState("");
  const [priority, setPriority] = useState("100");
  const [secret, setSecret] = useState("");
  const [accountSid, setAccountSid] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const selected = useMemo(
    () => EXECUTABLE_COMMUNICATION_PROVIDERS.find((provider) => provider.providerKey === registerKey)
      ?? EXECUTABLE_COMMUNICATION_PROVIDERS[0],
    [registerKey],
  );

  if (!isOpen) return null;

  function reset() {
    setSecret("");
    setAccountSid("");
    setFromAddress("");
    setFromNumber("");
    setStatus(null);
    setError(null);
    setWarnings([]);
  }

  async function registerConnector(credentialRef: string) {
    const response = await fetch(`/api/communications/providers${window.location.search}`, {
      method: "POST",
      headers: reauthHeaders(),
      body: JSON.stringify({
        providerKey: selected.providerKey,
        providerType: selected.providerType,
        connectorKey: connectorKey.trim() || undefined,
        region: region.trim() || undefined,
        priority: Number(priority) || 100,
        custodyMode: "DELEGATED",
        capabilityKeys: [selected.capabilityKey],
        credentialRef,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(apiError(result, "Provider registration failed."));
  }

  async function runByokIntake(): Promise<string> {
    if (!secret.trim()) throw new Error("Enter the API secret or token to store.");
    if (selected.custodyBaseKey === "twilio" && !accountSid.trim()) {
      throw new Error("Twilio Account SID is required.");
    }
    const effectiveConnectorKey = connectorKey.trim()
      || `comm-${selected.providerKey}-${crypto.randomUUID().slice(0, 8)}`;

    setStatus("Requesting a one-time wrapping key…");
    const keyRes = await fetch(`/api/custody/wrapping-key${window.location.search}`, {
      headers: reauthHeaders(false),
    });
    const keyBody = await keyRes.json();
    if (!keyRes.ok) throw new Error(apiError(keyBody, "Could not obtain a wrapping key."));

    setStatus("Wrapping the credential in your browser…");
    const envelope = await wrapSecret(keyBody as PublishedWrappingKey, secret);
    const parameters: Record<string, string> = {};
    if (accountSid.trim()) parameters.accountSid = accountSid.trim();
    if (region.trim()) parameters.region = region.trim();
    if (fromAddress.trim()) parameters.fromAddress = fromAddress.trim();
    if (fromNumber.trim()) parameters.fromNumber = fromNumber.trim();

    setStatus("Probing the credential with the provider…");
    const intakeRes = await fetch(`/api/custody/credentials${window.location.search}`, {
      method: "POST",
      headers: reauthHeaders(),
      body: JSON.stringify({
        connectorKey: effectiveConnectorKey,
        providerKey: selected.custodyBaseKey,
        envelope,
        parameters,
      }),
    });
    const intakeBody = await intakeRes.json();
    if (Array.isArray(intakeBody?.warnings) && intakeBody.warnings.length > 0) {
      setWarnings(
        intakeBody.warnings
          .map((warning: unknown) => typeof warning === "string"
            ? warning
            : typeof warning === "object" && warning !== null && "message" in warning
              ? String((warning as { message: unknown }).message)
              : "")
          .filter(Boolean),
      );
    }
    if (!intakeRes.ok) throw new Error(apiError(intakeBody, "The credential could not be verified."));
    if (typeof intakeBody.credentialRef !== "string" || intakeBody.credentialRef.length === 0) {
      throw new Error("Credential custody did not return a canonical credential reference.");
    }
    if (!connectorKey.trim()) setConnectorKey(effectiveConnectorKey);
    return intakeBody.credentialRef;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setWarnings([]);
    setStatus(null);
    try {
      const credentialRef = await runByokIntake();
      setStatus("Registering the connector…");
      await registerConnector(credentialRef);
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
    width: "100%",
    padding: "8px 12px",
    border: "1px solid var(--line, #cbd5e1)",
    borderRadius: 8,
    fontSize: 13,
    outline: "none",
  };

  return (
    <div role="presentation" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(15,23,42,.6)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}>
      <form onSubmit={submit} onClick={(event) => event.stopPropagation()} style={{ width: "min(580px, 100%)", maxHeight: "90vh", overflowY: "auto", background: "var(--surface, var(--theme-text-inverse))", borderRadius: 16, padding: 28, display: "grid", gap: 14 }}>
        <div>
          <p style={{ margin: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--theme-text-secondary)" }}>Platform communications</p>
          <h2 style={{ margin: "4px 0 0" }}>Register executable provider</h2>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--theme-text-secondary)" }}>
            Only providers with a governed EXPADIO execution adapter are offered here. Future catalog providers remain unavailable until their send and lifecycle paths are wired and certified.
          </p>
        </div>

        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Provider
          <select value={registerKey} onChange={(event) => setRegisterKey(event.target.value)} style={field}>
            {EXECUTABLE_COMMUNICATION_PROVIDERS.map((provider) => (
              <option key={provider.providerKey} value={provider.providerKey}>
                {provider.label} · {provider.providerType}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Connector key
            <input value={connectorKey} onChange={(event) => setConnectorKey(event.target.value)} placeholder="Optional stable key" style={field} />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Region
            <input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="us-east-1" style={field} />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Priority
            <input type="number" min="0" value={priority} onChange={(event) => setPriority(event.target.value)} style={field} />
          </label>
          <div style={{ display: "grid", gap: 4, fontSize: 12 }}>Capability
            <div style={{ ...field, background: "#f8fafc", fontFamily: "monospace", fontSize: 12 }}>{selected.capabilityKey}</div>
          </div>
        </div>

        <fieldset style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 10, padding: 12, margin: 0 }}>
          <legend style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--theme-text-secondary)", padding: "0 6px" }}>Credential custody</legend>
          <p style={{ margin: 0, fontSize: 12 }}>
            <strong>Governed BYOK</strong> — the secret is wrapped in this browser, probed, vaulted, and registered by reference. Credential-less customer-egress execution is not exposed because these adapters require governed credentials at runtime.
          </p>
        </fieldset>

        <div style={{ display: "grid", gap: 10, border: "1px dashed var(--line, #cbd5e1)", borderRadius: 10, padding: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12 }}>API secret / token
            <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="Wrapped in your browser before it is sent" style={field} autoComplete="off" />
          </label>
          {selected.custodyBaseKey === "twilio" && (
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Account SID
              <input value={accountSid} onChange={(event) => setAccountSid(event.target.value)} placeholder="ACxxxxxxxx" style={field} />
            </label>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>From address
              <input value={fromAddress} onChange={(event) => setFromAddress(event.target.value)} placeholder="no-reply@brand.com" style={field} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>From number
              <input value={fromNumber} onChange={(event) => setFromNumber(event.target.value)} placeholder="+15551234567" style={field} />
            </label>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: "var(--ink-500, #64748b)" }}>The raw secret is never submitted as plaintext.</p>
        </div>

        {status && <p style={{ margin: 0, fontSize: 12, color: "var(--brand, var(--theme-primary))" }}>{status}</p>}
        {warnings.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--theme-warning)", background: "color-mix(in srgb,var(--theme-warning) 12%,transparent)", padding: 10, borderRadius: 8 }}>
            {warnings.map((warning, index) => <div key={index}>⚠️ {warning}</div>)}
          </div>
        )}
        {error && <p role="alert" style={{ color: "var(--theme-danger)", margin: 0, fontSize: 13 }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={() => { reset(); onClose(); }} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--line, #cbd5e1)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "var(--brand, var(--theme-primary))", color: "var(--theme-text-inverse)", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Working…" : "Verify & register"}
          </button>
        </div>
      </form>
    </div>
  );
}
