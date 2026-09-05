"use client";

import { useMemo, useState } from "react";
import { apiError } from "../../../lib/api-error";
import { wrapSecret, type PublishedWrappingKey } from "../../../lib/custody-wrap";
import { EXECUTABLE_COMMUNICATION_PROVIDERS } from "../../../lib/communication-runtime-providers";
import { MotionStatus } from "@expadio/ui";

type ProviderModalProps = { isOpen: boolean; onClose: () => void; onCreated: () => void };

/**
 * Provider registration is a governed, step-up-guarded flow (design §2–§3), not
 * a plain form:
 *   - DELEGATED (BYOK): fetch a wrapping key, wrap the secret in the browser,
 *     POST /custody/credentials to probe + vault it, then register with the
 *     returned reference. The plaintext secret never leaves the tab in the clear.
 *
 * Every custody and provider call carries a fresh step-up header (§3.4).
 */

function standardStepUp() {
  const token = document.cookie
    .split("; ")
    .find((row) => row.startsWith("expadio_auth="))
    ?.split("=")[1];
  return {
    Authorization: `Bearer ${token}`,
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

  const selected = useMemo(() => EXECUTABLE_COMMUNICATION_PROVIDERS.find((p) => p.providerKey === registerKey)!, [registerKey]);

  function reset() {
    setConnectorKey("");
    setRegion("");
    setPriority("100");
    setSecret("");
    setAccountSid("");
    setFromAddress("");
    setFromNumber("");
    setSaving(false);
    setStatus(null);
    setError(null);
    setWarnings([]);
  }

  async function registerConnector(credentialRef: string | null, capabilities: string[]) {
    const res = await fetch(`/api/communications/providers${window.location.search}`, {
      method: "POST",
      headers: { ...standardStepUp(), "Content-Type": "application/json" },
      body: JSON.stringify({
        providerKey: selected.providerKey,
        connectorKey: connectorKey.trim() || undefined,
        capabilities,
        region: region.trim() || undefined,
        priority: parseInt(priority, 10),
        credentialRef,
        custodyMode: "DELEGATED",
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(apiError(body, "Failed to register the connector."));
  }

  async function runByokIntake() {
    if (!secret.trim()) throw new Error("BYOK requires an API secret.");
    setStatus("Requesting a one-time wrapping key…");
    const keyRes = await fetch("/api/custody/wrapping-key", { headers: standardStepUp() });
    const keyBody = await keyRes.json();
    if (!keyRes.ok) throw new Error(apiError(keyBody, "Could not fetch a wrapping key."));
    const key = keyBody as PublishedWrappingKey;

    setStatus("Wrapping your secret locally…");
    const envelope = await wrapSecret(key, secret);
    const effectiveConnectorKey = connectorKey.trim() || `${selected.providerKey}-byok-${Date.now().toString().slice(-4)}`;

    setStatus("Vaulting and probing the credential…");
    const intakeRes = await fetch("/api/custody/credentials", {
      method: "POST",
      headers: { ...standardStepUp(), "Content-Type": "application/json" },
      body: JSON.stringify({
        targetSystem: selected.providerKey,
        credentialIdentifier: effectiveConnectorKey,
        wrappedEnvelope: envelope,
        wrappingKeyId: key.kid,
        metadata: {
          accountSid: accountSid.trim() || undefined,
          fromAddress: fromAddress.trim() || undefined,
          fromNumber: fromNumber.trim() || undefined,
        },
      }),
    });
    const intakeBody = await intakeRes.json();
    if (intakeBody.warnings && Array.isArray(intakeBody.warnings)) {
      setWarnings(
        intakeBody.warnings
          .map((warning: unknown) =>
            typeof warning === "string"
              ? warning
              : typeof warning === "object" && warning !== null && "message" in warning
              ? String((warning as { message: unknown }).message)
              : "")
          .filter(Boolean),
      );
    }
    if (!intakeRes.ok) throw new Error(apiError(intakeBody, "The credential could not be verified."));
    if (typeof intakeBody.reference !== "string" && typeof intakeBody.credentialRef !== "string") {
      throw new Error("Credential custody did not return a canonical credential reference.");
    }
    if (!connectorKey.trim()) setConnectorKey(effectiveConnectorKey);
    const credentialRef = intakeBody.credentialRef || intakeBody.reference;
    return { reference: credentialRef, capabilities: [selected.capabilityKey] };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setWarnings([]);
    setStatus(null);
    try {
      const { reference, capabilities } = await runByokIntake();
      setStatus("Registering the connector…");
      await registerConnector(reference, capabilities);
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
    border: "1px solid var(--theme-border)",
    borderRadius: "var(--theme-radius-card)",
    fontSize: 13,
    outline: "none",
  };

  if (!isOpen) return null;

  return (
    <div role="presentation" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(15,23,42,.6)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}>
      <form
        role="dialog"
        aria-label="Register communications provider"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: "var(--theme-surface)",
          border: "1px solid var(--theme-border)",
          borderRadius: "var(--theme-radius-card)",
          boxShadow: "var(--theme-shadow-elevated)",
          width: "100%",
          maxWidth: 480,
          padding: 24,
          display: "grid",
          gap: 20,
          animation: "providerDialogIn var(--theme-transition-entrance) both"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, letterSpacing: "-.02em" }}>Register communications provider</h2>
          <button type="button" onClick={onClose} style={{ background: "transparent", border: 0, fontSize: 20, cursor: "pointer", color: "var(--theme-text-muted)" }}>&times;</button>
        </div>

        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Provider
          <select value={registerKey} onChange={(event) => setRegisterKey(event.target.value)} style={{ ...field, background: "var(--theme-surface-raised)" }}>
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
            <div style={{ ...field, background: "var(--theme-surface-muted)", fontFamily: "monospace", fontSize: 12 }}>{selected.capabilityKey}</div>
          </div>
        </div>

        <fieldset style={{ border: "1px solid var(--theme-border)", borderRadius: "var(--theme-radius-card)", padding: 12, margin: 0 }}>
          <legend style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--theme-text-secondary)", padding: "0 6px" }}>Credential custody</legend>
          <p style={{ margin: 0, fontSize: 12 }}>
            <strong>Governed BYOK</strong> — the secret is wrapped in this browser, probed, vaulted, and registered by reference. Credential-less customer-egress execution is not exposed because these adapters require governed credentials at runtime.
          </p>
        </fieldset>

        <div style={{ display: "grid", gap: 10, border: "1px dashed var(--theme-border)", borderRadius: "var(--theme-radius-card)", padding: 12 }}>
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
          <p style={{ margin: 0, fontSize: 11, color: "var(--theme-text-muted)" }}>The raw secret is never submitted as plaintext.</p>
        </div>

        {status && <MotionStatus live tone="info">{status}</MotionStatus>}
        {warnings.length > 0 && (
          <div style={{ fontSize: 12, color: "var(--theme-warning)", background: "color-mix(in srgb,var(--theme-warning) 12%,transparent)", padding: 10, borderRadius: "var(--theme-radius-card)" }}>
            {warnings.map((warning, index) => <div key={index}>⚠️ {warning}</div>)}
          </div>
        )}
        {error && <p role="alert" style={{ color: "var(--theme-danger)", margin: 0, fontSize: 13 }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={() => { reset(); onClose(); }} style={{ padding: "8px 16px", borderRadius: "var(--theme-radius-card)", border: "1px solid var(--theme-border)", background: "transparent", cursor: "pointer" }}>Cancel</button>
          <button type="submit" disabled={saving} style={{ padding: "8px 16px", borderRadius: "var(--theme-radius-card)", border: 0, background: "var(--theme-primary)", color: "var(--theme-text-inverse)", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "Working…" : "Verify & register"}
          </button>
        </div>
      </form>
    </div>
  );
}
