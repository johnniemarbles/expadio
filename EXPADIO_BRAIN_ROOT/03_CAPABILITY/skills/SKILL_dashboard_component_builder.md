---
skill_id: SKILL-UI-001
title: Premium SaaS Dashboard Component Architect
version: 1.1.0
owner: EXPADIO Brain OS
category: UI_ENGINEERING
governance_dependencies:
  - 02_GOVERNANCE/policies/brand_voice_policy.md
  - 02_GOVERNANCE/policies/design_tokens_contract.md
  - 05_COMMUNICATION_PANEL/spec.md
---

# SKILL: Premium SaaS Dashboard Component Architect

## 1. Objective
Generate production-ready, type-safe React/Next.js dashboard components adhering strictly to the EXPADIO Design System, CSS variable token contract, and the Tri-State Operational Health Model.

## 2. Operating Constraints (Source: CBOS Governance)
- **State-Driven Design:** Every component renders strictly from computed runtime signals (e.g., `connectorCount === 0`, `status === 'DEGRADED'`). No hardcoded mock assumptions.
- **Token Contract Compliance:** Zero raw hex values (e.g., `#09090b` is prohibited). All styling must resolve to platform CSS variables:
  - Surfaces: `var(--surface)`, `var(--surface-raised)`, `var(--surface-muted)`
  - Strokes: `var(--border)`, `var(--border-subtle)`, `var(--border-hover)`
  - Typography: `var(--text)`, `var(--text-muted)`, `var(--text-inverse)`
  - Accents & Semantics: `var(--accent)`, `var(--positive)`, `var(--warning)`, `var(--danger)`
- **Zero Hallucination Policy:** Illustrative fake numbers (e.g., "1,284 users", "99.9% uptime") are strictly forbidden. Use real input props or state fallback indicators (`—`, `No data`).
- **Fail-Closed & Resilience:** Any unhandled exception or missing capability must drop to an isolated error/denied boundary with an operational remediation link—never break the host layout or hang on an indefinite spinner.
- **Physics-Backed Motion:** All transitions must use Framer Motion / Motion with physics presets:
  - Standard Reveal: `stiffness: 305, damping: 33`
  - Snappy Interaction: `stiffness: 1218, damping: 70`
  - Ambient / Float: `stiffness: 43, damping: 13`

## 3. Operational State Matrix
Every component must formally implement and render across two tiers:

### Tier A: Operational Health (Business Level)
1. **UNCONFIGURED:** High-impact call-to-action state (e.g., "Connect Data Source"). Suppress complex metric charts and sparklines.
2. **STEADY:** High-density, minimal-noise operational layout. Primary indicators surfaced; deep audit/debug logs hidden behind contextual drawers/tabs.
3. **DEGRADED:** Console-expansion mode. Must explicitly display:
   - **Blast Radius:** Scope of impact (e.g., "Affecting 3 downstream queues").
   - **Root Cause:** Upstream signal or error payload.
   - **Remediation Action:** Inline trigger or drawer link (e.g., "Rotate Webhook Key").

### Tier B: Lifecycle Status (Network & Auth Level)
- **LOADING:** Native skeleton pulse (`bg-[var(--surface-muted)] animate-pulse`), preserving dimensions to avoid layout shift.
- **EMPTY:** Informative, low-prominence zero-state with a direct creation action.
- **NOT_ENTITLED / DENIED:** Disabled card surface containing a lock indicator and license tier upgrade trigger.
- **ERROR:** Bounded inline error banner with error code and retry mechanism.

## 4. Execution Workflow
1. **Context Ingestion:** Validate user input against registered tokens and RBAC capabilities.
2. **Architecture Blueprint:** Outline DOM structure, responsive boundaries, and accessibility targets (ARIA attributes).
3. **State Transition Table:** Map props to the 3 Operational States and Lifecycle flags.
4. **Code Generation:** Deliver fully typed TypeScript, React (Next.js client/server bounded), and Tailwind/Motion code.
5. **Acceptance Verification:** Verify component satisfies zero hardcoded color rules, keyboard accessibility, and state resilience gates.

## 5. Input Format
When invoking this skill, provide:
- **Component Identifier:** (e.g., `ClusterThroughputGauge`, `QueueTelemetryCard`)
- **Product Domain:** (e.g., `Learning`, `Communications`, `Workflows`)
- **Signals / Data Payload:** Input props schema and operational thresholds defining `DEGRADED`.

## 6. Standard Deliverables
1. **Component Blueprint:** Layout architecture, props interface, and state enum definition.
2. **State Transition Logic:** Pure reducer or state calculation function mapping telemetry to operational states.
3. **Production Implementation:** Full production code file, complete with token bindings, accessible markup, and entrance animations.
