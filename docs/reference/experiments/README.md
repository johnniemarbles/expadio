# EXPADIO Vertical Experiment Reference Archive

**Status:** Archive — not part of the EXPADIO core product

---

## What This Directory Contains

These are the source files and test results from the **DENTEX** and **WeRealtors** experiments — two tenant vertical domains implemented during early EXPADIO development to prove the platform model works end-to-end.

Preserved here as **reference implementations** showing:
- How a brand/tenant authors domain vocabulary on top of the neutral EXPADIO engine
- What a case schema, treatment journey, or real estate escrow looks like as EXPADIO workflow config
- Integration test patterns for governed workflows, domain events, and multi-tenant execution

## Why They Were Removed from Core

EXPADIO is a **plug-and-play infrastructure provider**. Dental clinics, real estate brokerages, and any other brand onboard as tenants — they do not get special vertical code in the platform repo.

The model:
```
Brand onboards to EXPADIO
    → Configures connectors (email, SMS, voice, webhooks)
    → Configures workflows (onboarding, approvals, qualification)
    → Optionally authors an Industry Pack (terminology + case schema)
    → AI activates per-brand context, learns, adapts, helps
    → EXPADIO Brain learns from AI across all brands (governed)
```

DENTEX and WeRealtors are examples of **what a future tenant brand looks like** — not platform primitives.

## Directories

| Directory | Contents |
| :--- | :--- |
| `dentex/src/` | Clinical domain model: CDT procedures, tooth ontology, treatment journey, care plan |
| `dentex/test/` | Unit tests: clinical care plan, treatment journey, treatment schema |
| `dentex/itest/` | Integration tests: treatment discharge, provider relationships, projections, readiness |
| `werealtors/src/` | Residential listing attributes, real estate escrow journey stages |
| `werealtors/test/` | Journey test |
| `DENTEX-EXTRACTION-MAP.md` | Architecture decision record for DENTEX domain extraction |

## How to Use as a Future Tenant Onboarding Guide

A future `DentalClinicBrand` tenant would:
1. Onboard to EXPADIO (org + users + connectors)
2. Reference `dentex/src/clinical-care-plan.ts` to author a matching Industry Pack definition
3. Configure governed workflows matching the `treatment-journey.ts` stage gates
4. Their AI agent uses the EXPADIO AI gateway within their tenant context

The platform engine is unchanged. The brand brings their domain vocabulary.
