# Communications: platform integration, brand configuration

## Scope of this first implementation slice

Base inspected: `7dc9941cce0359397d479caa531df938b39e9a2b`.

- New Communications connectors are PLATFORM-owned, not tenant-owned.
- Provider collection, detail, health, blast-radius, attestation, revocation,
  test-send and credential-intake endpoints require database-backed platform
  authority before processing their requests.
- Platform scope no longer trusts `x-expadio-scope`. It requires a current,
  active platform role and assignment in the authenticated workspace.
- Scoped assignments and active restrictions fail closed for this broad
  infrastructure privilege. Fine-grained delegated administration is not
  implemented by this guard.
- Provider queries now run with tenant settings inside an explicit transaction.
- Automatic admin grants default off; demo grants are forbidden in production.
- The Communications page resolves access before fetching provider metadata.
  Brands receive a separate activity/readiness view, without provider or
  credential controls. Self-service brand configuration is explicitly pending.
- Provider intake and connector registration retain the same generated key.

Existing tenant-owned connectors, sender data and role grants are preserved.
This change does not merge, migrate or delete them, send messages, configure
live credentials, or activate providers.

## Validation performed

- 16 focused Node tests: existing Communications contracts plus new authority,
  automatic-grant, route-guard and UI separation regressions.
- 16 authority scenarios against embedded PostgreSQL (PGlite): legitimate
  administrators, forged scope, wrong subject/tenant/organization, revoked,
  future and expired assignments, inactive/tenant roles, scoped assignments,
  active/inactive restrictions and super-admin access.
- 11 actual HTTP handlers invoked with a mocked authenticated brand context
  claiming platform scope. All returned 403 before downstream work. Framework,
  authentication and provider dependencies were stubbed; this is not live E2E.
- Strict standalone typecheck of the dependency-free authority module.
- Full app build, authenticated browser QA, production PostgreSQL RLS tests
  and real provider delivery have NOT been validated in this environment.

## Rollout blockers and follow-on work

This is not the completed provider integration project. Keep this slice in
review until full application and deployment checks are complete.

1. Review existing platform role assignments before rollout: the previous
   default auto-granted administrator roles. Changing the default does not
   revoke historical grants. Do not mass-revoke without identifying legitimate
   administrators and preserving their access.
2. Replace client timestamp-based step-up with verified authentication-provider
   reverification. The existing header is not evidence of a second factor.
3. Deploy and validate migration 0082 before the receipt-enabled routes.
   Legacy credentials have no receipt and cannot be newly activated through
   this API. Plan re-onboarding/rotation; existing enabled connectors are not
   silently disabled or assigned fabricated proof.
4. Complete platform credential namespace/custody lifecycle and prove a shared
   connection executes for two distinct brands with isolated senders and usage.
5. Add channel entitlements, routing eligibility and quotas for each brand,
   enforced at enqueue and send time. Provider visibility is not entitlement.
6. Replace hardcoded DNS instructions in the current domains endpoint with
   provider-issued records and authoritative verification. Do not expose that
   legacy form as finished brand onboarding.
7. Add brand sender, template, consent and preference configuration with backend
   permissions. The new brand view intentionally offers no unfinished writes.
8. Complete each chosen provider's adapter, verification, test send, webhook,
   reconciliation and recovery path. A catalogue entry is not an integration;
   the inspected worker/test-send path is Resend-specific.
9. Audit revocation dual-control evidence, correct queue cancellation persistence
   and cross-brand impact reporting before shared production revocation.

Acceptance: platform administrators integrate once; entitled brands configure
only their identity/content/preferences; the platform executes securely and
attributes every delivery to the correct brand without disclosing credentials.

## Continuation: server-recorded intake and activation boundary

- Successful probe/vault intake issues a 15-minute receipt, bound to the
  authenticated subject, workspace, connector key, provider and secret reference.
  Receipt storage contains metadata only, with forced tenant/admin RLS.
- Registration atomically consumes the receipt alongside connector/credential
  insertion. Replay, expiration and mismatched identity fail closed. Rollback
  restores receipt availability if registration fails.
- Fingerprint, version, probe time, warnings and detected capabilities come
  from persisted evidence, never registration request claims. Requested
  capabilities must be present in the recorded probe result.
- New delegated connectors remain disabled until explicitly activated.
  Activation rejects manual health updates, missing/legacy/expired/blocked
  credentials and unsupported execution adapters. Only the existing Resend
  email adapter is admitted by this gate. This is credential/adapter admission,
  not proof of production sender/domain readiness or brand entitlement.
- External-egress registration remains a disabled placeholder, clearly labeled
  as unsupported for delivery. Other custody registration modes fail closed
  until they have their own verified evidence path.
- Probe/vault network work stays outside the short receipt transaction. Failed
  receipt persistence can leave an unused vault version; lifecycle cleanup and
  rotation/re-onboarding remain follow-on work. No automatic secret deletion.

Additional validation: 13 focused unit tests; strict standalone helper/test
typecheck; the committed PostgreSQL integration test executed against PGlite
with the real migration (identity mismatch, expiry, replay and rollback).
Actual POST/PATCH handlers also passed local PGlite checks for forged metadata,
activation/disable behavior and blocking warnings; framework/auth were stubbed.
Receipt SELECT RLS was checked under a non-superuser role for brand, platform
admin and wrong-tenant contexts. This is not deployed RLS, concurrent-load,
authenticated browser or live provider E2E validation. CI must pass on this
continuation before review completion.
