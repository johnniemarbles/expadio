# Communications Live Certification

This document is the release gate for declaring a communication capability **LIVE** in EXPADIO.

A provider adapter, green unit test, successful credential probe, or accepted provider API response is **not** sufficient on its own. A capability is LIVE only when the full governed path is proven with real provider evidence and no raw credential material enters source control, logs, browser persistence, or chat.

## Source of truth

Certification evidence is evaluated in this order:

1. executing production code
2. automated tests and CI
3. durable database evidence (`communication_deliveries`, `communication_provider_attempts`, provider webhook events, delivery events, decision/execution traces)
4. provider console evidence
5. documentation

Documentation never overrides contradictory code or runtime evidence.

## Credential handling

- Existing BEMP Resend/Twilio secret **values are not ported through GitHub source**.
- Operators re-enter credentials through EXPADIO credential custody or use an approved external vault reference.
- Twilio delegated custody stores a runtime bundle containing the Account SID and Auth Token after a successful read-only provider probe.
- Provider execution and webhook verification must resolve credentials through an authorized, audited, short-lived lease.
- `TWILIO_AUTH_TOKEN`, Resend API keys, or equivalent provider secrets must not be read directly by communication routes.

## Capability matrix

| Capability | Provider | Connector provider key | Adapter | Required webhook evidence |
| --- | --- | --- | --- | --- |
| Email | Resend | `resend` | `resend-email-v1` | signed Resend event reaches terminal delivery lifecycle |
| SMS | Twilio | `twilio-sms` | `twilio-sms-whatsapp-v1` | signed Twilio status callback reaches `SENT`/`DELIVERED` or explicit failure |
| WhatsApp | Twilio | `twilio-whatsapp` | `twilio-sms-whatsapp-v1` | signed Twilio WhatsApp callback reaches `SENT`/`DELIVERED` or explicit failure |
| Voice | Twilio | `twilio-voice` | `twilio-voice-v1` | signed Twilio call callback reaches `DELIVERED` or explicit failure |

Direct Meta Cloud API is **not certified by this matrix**. Twilio WhatsApp certification must not be presented as direct Meta/WABA Cloud API certification.

## Preconditions

Before a live certification attempt:

- provider connector exists under the intended tenant and is enabled;
- credential custody probe is `VALID` and blocking warnings are resolved;
- connector capability matches provider/channel/adapter tuple;
- sender identity is present, active, verified, and allowed for the communication purpose;
- required consent evidence exists for channels that require consent;
- recipient is not suppressed;
- the communication worker service subject is configured and authorized for `credential.lease` on connector credentials;
- provider callback URL is registered with the provider using the exact public Platform URL;
- Railway/public origin configuration resolves to the externally visible Platform domain;
- callback endpoint contains explicit `tenantId` and `connectorKey` coordinates.

## Certification procedure

For each capability, execute one unique certification message/call with a stable unique idempotency key and record the following evidence.

### 1. Credential custody

Confirm:

- intake probe succeeds;
- returned value is an opaque credential reference only;
- connector credential row is ACTIVE;
- no raw secret appears in connector metadata, request logs, trace payloads, or application responses.

### 2. Governed dispatch

Submit the message through the normal `COMMUNICATE` path, not by calling a provider SDK manually.

Expected durable evidence:

- one `platform.communication_deliveries` row;
- connector key and adapter key match the certified tuple;
- immutable dispatch snapshot is present;
- delivery starts `PENDING` and is claimed by the worker;
- compliance is re-evaluated immediately before provider execution.

### 3. Provider attempt

Expected evidence:

- credential lease is authorized and audited;
- provider receives exactly one attempt for the idempotency/claim attempt;
- one append-only `platform.communication_provider_attempts` record exists;
- provider key, connector key, adapter key and provider message ID are present;
- accepted provider call changes the delivery to `ACCEPTED` or is reconciled to accepted after claim loss.

### 4. Signed provider callback

Expected evidence:

- webhook signature is verified over the exact public callback URL and raw request body;
- callback credential is resolved through governed custody/lease;
- no default tenant or connector fallback exists;
- event channel matches the configured connector channel;
- provider event is written to `platform.communication_provider_webhook_events`;
- duplicate callback is replay-safe and does not duplicate lifecycle mutation.

Twilio callback event identity is deterministic per lifecycle observation (`provider SID + status`) so `sent` and later `delivered` events are distinct while exact replays remain idempotent.

### 5. Terminal lifecycle

Certification passes only if the provider callback advances the canonical delivery to a terminal/expected state:

- Resend email: `DELIVERED`, `BOUNCED`, `COMPLAINED`, or explicit provider failure;
- Twilio SMS/WhatsApp: `DELIVERED` or explicit failure after accepted/sent evidence;
- Twilio Voice: `DELIVERED` (completed) or explicit terminal failure.

A provider API `2xx` without callback reconciliation is **accepted**, not **certified delivered**.

### 6. Traceability

The operator must be able to start from the original governed action/correlation ID and locate:

`COMMUNICATE → delivery → provider attempt → provider message ID → signed webhook event → delivery state transition → execution/decision trace`

If any link is missing, the capability remains **READY FOR CERTIFICATION**, not LIVE.

## Required certification record

For each live-certified capability, record:

- UTC certification timestamp;
- tenant and connector key;
- provider and channel;
- non-secret sender identity;
- redacted recipient identifier;
- idempotency key;
- delivery ID;
- provider-attempt ID;
- provider message ID;
- provider webhook event ID(s);
- final canonical delivery state;
- decision/execution trace ID;
- CI commit SHA used for certification;
- operator identity;
- known provider restrictions (trial/sandbox, throughput, approved WhatsApp templates, geographic restrictions).

Never paste API keys, auth tokens, session tokens, webhook secrets, full credential payloads, or vault secret values into the certification record.

## Failure policy

Certification fails closed when any of the following occurs:

- provider credential cannot be leased or resolved;
- provider/channel/adapter tuple does not match;
- sender identity is unavailable or unverified;
- consent/suppression evidence refuses the send;
- provider attempt is missing durable evidence;
- callback signature is invalid or cannot be verified against the public URL;
- callback channel conflicts with connector configuration;
- callback cannot be associated with the provider message ID;
- canonical delivery state does not reconcile;
- raw secret material is observed outside custody.

A failed certification must leave the connector/capability out of LIVE status until the failure is resolved and the full procedure is rerun.
