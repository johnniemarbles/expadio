# ADR 002: UI Foundation

**Status:** Accepted

## Context
We need a robust, maintainable UI foundation for the EXPADIO platform web application. The frontend must align with our principles of explicit authorization, clear wiring visibility, and provider-neutral architecture.

## Decisions

- **Framework:** Next.js App Router + React 19 + strict TypeScript.
- **Styling:** CSS custom properties for design tokens in `packages/ui`; CSS Modules for component styles. No Tailwind, no CSS-in-JS.
- **Component Library:** Custom-built. No third-party component library (Radix, shadcn, etc.).
- **Provider Neutrality:** No provider-specific dependencies in UI domain code.
- **Adapters:** Typed adapter interfaces (fixture → BFF → live API) — fixture permitted only behind the same interface that production uses.
- **Visibility:** Every screen must surface wiring status (fixture / partial / live).
- **Wiring Status UI:** Non-dismissible fixture banner when `source.kind === 'fixture'`.
- **Shared Contracts:** Shared `DeniedResult` type in `packages/ui`.
- **Filtering:** `loadAllowedWorkspaces()` adapter method — fixture returns all sections, live adapter filters by entitlement.
- **Agent Binding:** API-mediated and authorization-first (UI displays status, requests actions; never executes tools, holds credentials, or bypasses AuthorizedAgentRuntime).
- **Accessibility:** WCAG 2.1 AA, semantic HTML, keyboard operation, focus management.
- **Responsive Design:** 3 breakpoints (desktop / tablet-sidebar-collapsed / mobile).
- **Testing:** Vitest + Testing Library for UI tests; interaction tests required at first live mutation.
- **BFF:** No general-purpose BFF inside platform-web — thin forwarders to EXPADIO application APIs only.
- **Priorities:** Capabilities + Governance prioritized over Organizations CRUD.
