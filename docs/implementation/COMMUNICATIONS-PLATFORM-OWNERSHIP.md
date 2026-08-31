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
2. Validate the provider reverification flow against the deployed Clerk instance,
   including stale sessions, supported factors and cancellation. Provider/custody
   controls now use server-verified session evidence; other application routes
   still using the legacy timestamp-based requireStepUp helper need a separate
   migration. This change does not enforce MFA enrollment.
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

## Continuation: provider session reverification

- All seven sensitive provider/custody handlers now require Clerk-authenticated
  reverification after platform authority and before body parsing or work.
  Registration, activation/disable, retirement, revocation, test send, wrapping
  key issuance and intake are covered. Read-only provider metadata is unchanged.
- The authenticated subject must match the resolved request subject. Freshness
  is checked by auth().has(), using multi_factor with a five-minute window.
  As documented by Clerk, users without an enrolled second factor fall back to
  first-factor verification; mandatory MFA enrollment is a separate policy.
- Server-issued challenges are returned without rewriting their protocol, with
  no-store caching. Provider UI calls use useReverification, and no longer send
  x-expadio-reauth-at. The existing generic requireStepUp helper is untouched for
  non-provider callers; it must not be reused for provider administration.
- Clerk unwraps raw Response objects into JSON. The client transport therefore
  passes challenge objects directly, but envelopes ordinary responses to keep
  status, headers and unread bodies available to existing error handling.
- A denied HTTP request can be retried after verification; an entire successful
  intake/registration chain is never replayed automatically. Cancellation or a
  repeated challenge cannot be reported as success. A wrapping key that expires
  while the user is verifying still requires restarting intake normally.

Validation: 40 focused Node tests passed (new policy/transport regressions plus
existing Communications, custody and authority contracts). Helpers typechecked
against @clerk/nextjs 7.8.2 and its installed dependencies. Actual seven handlers
were tested with authenticated-session stubs and Clerk's real factor-age checker:
forged fresh timestamps did not bypass stale signed-session evidence, brand
authority was checked first, and no downstream effect ran before challenge.
A local harness using the installed SDK retry-handler source verified success,
cancellation, bounded retry and ordinary denial; UI opening was stubbed.
Authenticated browser/deployed Clerk verification and live sends were not run.

Reference: https://clerk.com/docs/guides/secure/reverification

## Continuation: shared credential send-time safety

- Corrected the remaining flows-thorough assertion that required the removed
  browser timestamp header. The test now requires the reverification transport
  and forbids that header; the custody handshake assertions remain in place.
- The Resend token binding verifies that the returned lease matches the sending
  brand, selected connector and loaded credential reference before Vault reads.
  It rechecks lease validity after secret resolution, and refuses a secret that
  expired during the read or has invalid expiry metadata.
- Vault resolution requires returned version metadata to match the exact
  referenced version. Missing/mismatched versions fail closed instead of being
  accepted or inferred. Malformed UUID-shaped references fail before network I/O.
- A two-brand binding regression confirms the same PLATFORM-owned reference can
  be resolved with separate brand-scoped lease/audit identities. Repository,
  lease service and secret resolution are test doubles in this test; this does
  not establish persisted multi-brand delivery, entitlement or usage isolation.

Validation: 24 binding/Vault tests, nine flow-contract tests and the earlier 40
focused Communications regressions passed locally. Vault helper/tests passed a
strict standalone typecheck. On the preceding commit, Core Spine, Workflow
Integration and Architecture Baseline passed; Platform Web failed only on the
obsolete timestamp assertion (364/365 tests passed). New commit CI must pass.

Additional shared-account rollout blocker: Resend currently forwards the local
request idempotencyKey unchanged. Two brands using the same local key on one
provider account need provider-level tenant namespacing. Implement with an
explicit transition for pending/in-flight retries; blindly changing the key can
duplicate an already accepted send. This continuation deliberately does not
change provider idempotency keys or perform live sends.

## Continuation: brand-scoped queued provider idempotency

- New governed queue deliveries pin `providerIdempotencyKey` in the immutable
  dispatch snapshot: `expadio:tenant:v1:` plus SHA-256 of the JSON tuple containing
  tenant ID and local idempotency key. Brands sharing a Resend account therefore
  receive distinct provider keys, while retries of one delivery reuse its key.
- Re-enqueue reads the existing delivery and preserves its pinned key, including
  absence on legacy snapshots. Repository snapshot equality remains the final
  conflict check. Existing rows are not rewritten or backfilled.
- Request preparation carries the pinned key to Resend's HTTP header. Database
  identity, credential lease requests and audit attribution retain the original
  tenant-scoped local key. Invalid explicit provider keys fail before credentials
  or network calls; they never silently fall back to the legacy key.
- Legacy deliveries without a pinned key retain their original wire key to
  avoid changing the identity of an already accepted send. Their original
  cross-brand collision risk remains. The separate operator test-send path is
  unchanged and still needs its own transition.

Deployment is coordinated, not a mixed-version rolling rollout: pause queue
producers, stop/drain old workers and in-flight provider calls, deploy all
producers/workers, then resume. Old workers ignore the new snapshot field and
must not process new snapshots. Rolling back to old workers after new snapshots
have been produced requires draining or isolating those deliveries first. Do
not recompute keys for legacy pending deliveries during deployment or rollback.

Validation: 28 focused communication tests passed, covering key isolation,
bounded deterministic hashing, queue replay with JSON-roundtripped snapshot
fixtures, provider preparation, wire headers, invalid keys and existing lease
checks. Communication source and these tests passed strict TypeScript checking.
Repository/network test doubles were used; persisted two-brand delivery E2E,
live provider sends and deployment were not performed. CI must pass on this
commit. The preceding commit passed all four CI workflows.

Resend retains idempotency keys for 24 hours; this namespace change does not
extend that window or guarantee exactly-once delivery beyond it. See
https://resend.com/docs/dashboard/emails/idempotency-keys.
