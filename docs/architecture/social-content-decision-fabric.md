# Social Content as Decision Fabric vertical

**Work type:** `social.content_publish`  
**Migration:** `infra/db/migrations/0057_social_content_publish.sql`  
**Module origin:** https://github.com/johnniemarbles/expadio-social-content

## Stages

| Stage | Gates |
|-------|--------|
| `DRAFT` | Author edits content |
| `BRAND_REVIEW` | Required participant `brand_approver` + decision APPROVE/REJECT |
| `APPROVED` | Publish allowed (connectors run outside this migration) |

Authority: **role + separation of duties only** (no `registerAuthorityDeriver`). Approver must not be the content author.

## Routes

- `GET/POST /api/social-content`
- `GET/POST/PATCH /api/social-content/[id]/workflow`
- `POST .../workflow/decision`
- `POST .../workflow/participants`
- `GET .../workflow/history`

## Publish gate (module responsibility)

Live social publish must require `stage_key = 'APPROVED'` (or status mirrored from `statusForStage`). Standalone `expadio-social-content` status machine is a dev shim only.

## Follow-ups

- [ ] Shell UI tab + WorkflowTraceModal
- [ ] Integration itest (SoD self-approval denied)
- [ ] Wire social-content packages (connectors, AI) as governed side-effect after APPROVED
- [ ] Feature-flag in Industry Packs
