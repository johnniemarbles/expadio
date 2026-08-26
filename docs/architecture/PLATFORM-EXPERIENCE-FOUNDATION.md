# Platform Experience Foundation

**Status:** Implementation baseline  
**Date:** 2026-08-26

## 1. Decision

Build the first EXPADIO web experience in `apps/platform-web` as a production application shell using Next.js App Router, React and strict TypeScript.

This shell serves the **Platform** audience. It consumes EXPADIO application APIs and does not become a second backend, policy engine, workflow engine or data-access layer.

## 2. Experience boundaries

The first command-center workspace exposes these product areas:

- Overview
- Organizations
- Capabilities
- Company Brain
- Governance
- Audit

Audience and channel remain separate dimensions. Future Brand, Client, Partner and Public web applications may reuse visual contracts, but their navigation and permissions remain audience-specific.

## 3. Data boundary

UI components consume typed view contracts through an adapter interface.

Initial development may use an explicitly labelled fixture adapter. The live adapter will call EXPADIO application APIs using the authenticated organization context. Neither adapter may:

- call PostgreSQL or provider SDKs directly;
- duplicate authorization or entitlement decisions;
- mutate domain state without an application command;
- hide the source or freshness of displayed data.

Fixture data is development evidence, never production truth. Every workspace must expose loading, empty, error and denied behavior as its live contract is connected.

## 4. Identity, scope and governance

Every live request carries authenticated identity and active organization scope. Server-side application boundaries remain responsible for authorization, entitlement, tenancy isolation and audit.

The UI may explain a denied decision but must not infer or override access. Governed actions must display their outcome and correlation or audit reference when the API supplies one.

## 5. Design system

The initial implementation establishes reusable design tokens for:

- color, typography, spacing, radius and elevation;
- focus, hover, selected, disabled and status states;
- responsive navigation and content density;
- accessible contrast, semantic landmarks and keyboard operation.

The first viewport is an operational workspace, not a marketing hero. Visual hierarchy favors current scope, system health, review work and traceable activity.

## 6. Delivery and validation

UI validation is path-scoped to `apps/platform-web/**` so backend-only changes do not consume frontend Action minutes. Frontend changes run one install-and-check job with concurrency cancellation.

The initial check is a TypeScript and production-build gate. Interaction tests are added when live workflows create behavior that cannot be proven by compilation and rendering alone.

## 7. Next implementation sequence

1. Establish the platform shell, tokens, responsive navigation and typed fixture adapter.
2. Connect scope-aware published skill and worker resolution.
3. Bind resolved workers to the governed agent runtime.
4. Add durable, resumable sessions.
5. Replace fixture workspace slices with live API adapters incrementally.

This sequence preserves the frozen EXPADIO architecture: BEMP remains canonical, provider details remain behind gateways, and agents use the same authorization and audit path as people.
