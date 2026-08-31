# Social Content as Decision Fabric vertical

**Status: DESIGN SPIKE — DO NOT MERGE UNDER FOUNDATION FREEZE**

**Work type:** `social.content_publish`  
**Migration sketch:** `infra/db/migrations/0057_social_content_publish.sql`  
**Module:** https://github.com/johnniemarbles/expadio-social-content (ADR-006)

## Program note (2026-08-31)

`FOUNDATION_FREEZE.md` pauses additional vertical implementation until the governed side-effect loop is proven and a human release decision is made. This branch keeps a correct **pattern copy** of `access.request` so Social Content can land without redesign later. It is **not** authorization to ship a fifth production vertical now.

Production publish must use Governed Action + credential custody + provider evidence + execution trace — not a parallel Nest runtime from the standalone module.

## Stages (sketch)

| Stage | Gates |
|-------|--------|
| `DRAFT` | Author edits |
| `BRAND_REVIEW` | `brand_approver` + APPROVE/REJECT |
| `APPROVED` | Eligible for governed publish action |

Authority: role + SoD only.

## Routes (sketch)

Factory routes under `/api/social-content/...` — same as other verticals.

## Follow-ups (after freeze allows)

- [ ] Explicit release decision
- [ ] Shell UI + WorkflowTraceModal
- [ ] SoD integration itest
- [ ] Governed publish executor + evidence
- [ ] Industry Pack feature flag
