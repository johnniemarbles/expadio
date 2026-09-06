# Import Agency Agents Persona as Draft CBOS Skill: Pipeline & Lead Health Analyst

**Proposed by:** Claude
**Date:** 2026-09-07
**Status:** Implemented
**Related area:** EXPADIO_BRAIN_ROOT/03_CAPABILITY/skills/, docs/architecture/COMPANY-BRAIN-CBOS.md, docs/architecture/ADR-017-LEAD-MANAGEMENT-GOVERNED-ENGINE.md

## Problem / Opportunity

CBOS's delivery order (`COMPANY-BRAIN-CBOS.md`) lists "governed skill and worker manifests" as step 4 — real, roadmapped, not yet populated with business-facing (non-UI-engineering) examples. The only existing skill manifest in `EXPADIO_BRAIN_ROOT/03_CAPABILITY/skills/` is `SKILL_dashboard_component_builder.md`, a UI-engineering skill.

Separately, the external Agency Agents persona library (`msitarzewski/agency-agents`) contains ~100 pre-written domain-specialist personas. Most (engineering/build-focused) don't fit CBOS — they don't reduce to the Agent Runtime schema (`AI-INTELLIGENCE-AND-VOICE.md` §8: identity/role/scope/permissions/tools/knowledge sources/budget/model policy/retention/audit) because they don't act through EXPADIO's closed AI tool list. But a subset of business-facing personas (sales, support, marketing) plausibly do.

This suggestion tests that hypothesis with one concrete, low-risk conversion before deciding whether to invest further in this as an import pattern.

## Proposal

Add a draft (unreviewed, non-activated) CBOS skill manifest at:

```
EXPADIO_BRAIN_ROOT/03_CAPABILITY/skills/candidates/SKILL_pipeline_health_analyst.md
```

(new `candidates/` subfolder, so draft imports are visibly separated from approved skills in `03_CAPABILITY/skills/` proper)

The manifest converts Agency Agents' `sales/sales-pipeline-analyst.md` persona into the CBOS schema:

- Full Agent Runtime declaration (identity, role, scope, permissions, tools restricted to the real closed list, knowledge sources scoped to a tenant Brain Map slice, budget/model/retention placeholders, audit)
- Read-only / diagnostic-only role: tools limited to `search_leads`, `get_organization`, `get_person`, `search_cases`, and proposal-only `create_task` — explicitly excludes `send_email`, `send_sms`, `initiate_call`, `create_workflow_action`
- Terminology rebound to EXPADIO's governed Lead Management vocabulary (`interestType`, `opportunityType`, `InterestTypeRegistry`, qualification profile resolved from versioned config) per ADR-017 Invariant 1, rather than the source persona's generic CRM/MEDDPICC framing
- Explicit statement that it cannot self-publish corrections to lead data, stage, or config (per CBOS: "No model or agent may publish its own correction directly")
- Activation checklist requiring independent review, filled-in budget/retention values, and human approval before it can leave `UNREVIEWED_PROPOSAL` status

Draft file content is attached in full below this suggestion for review (see Implementation notes).

## Expected benefits

- Gives CBOS a second, business-facing example skill manifest alongside the UI-engineering one, useful as a template for future imports
- Validates (or falsifies) whether Agency Agents personas are a viable seed source for CBOS skills, before investing time converting more
- Low blast radius: the pilot is deliberately read/diagnostic-only, cannot mutate lead or stage state, and stays in `UNREVIEWED_PROPOSAL` status pending review

## Risks / trade-offs

- Terminology drift risk: if the reviewer finds the mapping to `LeadManagementConfiguration` fields is approximate rather than exact (the draft was written without live schema access), it needs correction before it can be trusted as a template for further conversions
- Placeholder fields (budget ceiling, retention policy, model/provider policy) are not filled in — this file is not activation-ready as-is and must not be treated as such
- If accepted as a pattern, it implies future work to actually formalize a `candidates/` staging convention for external imports, which isn't currently defined anywhere in the repo

## Implementation notes

- New folder: `EXPADIO_BRAIN_ROOT/03_CAPABILITY/skills/candidates/`
- File: `SKILL_pipeline_health_analyst.md` (full content available separately — see attached draft)
- No code changes; this is a documentation/manifest-only suggestion
- If Accepted: an executor (Gemini or ChatGPT, per `OPERATING-MODEL.md`) claims the pack, verifies the tool/permission list and Lead Management field mappings against the actual live schema, fills in budget/retention values, and routes it through the correction lifecycle (`COMPANY-BRAIN-CBOS.md`) rather than committing it directly as "approved"
- If Rejected: useful signal that Agency Agents imports are not a good fit for CBOS skill sourcing, and this pattern should not be repeated for other personas

## Decision trail

- **2026-09-07** — Proposed by Claude (chat session, no direct repo write access — human or a connected agent must land this file per `CONNECTING-AGENTS.md`).

- **2026-09-07** — Implemented. The unreviewed proposal was independently reviewed, human approval (Sanjeev) was recorded, and the manifest was merged via PR #756. The file was graduated directly to `EXPADIO_BRAIN_ROOT/03_CAPABILITY/skills/` (bypassing dynamic Business Configuration changesets since skills currently rely on flat file manifests).
