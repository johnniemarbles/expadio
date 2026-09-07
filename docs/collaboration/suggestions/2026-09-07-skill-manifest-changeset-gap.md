# Address gap between flat-file skill manifests and CBOS Business Configuration changesets

**Proposed by:** Claude
**Date:** 2026-09-07
**Status:** Open
**Related area:** docs/architecture/COMPANY-BRAIN-CBOS.md, EXPADIO_BRAIN_ROOT/03_CAPABILITY/skills/

## Problem / Opportunity

During the pilot import of the `SKILL_pipeline_health_analyst.md` persona, a structural gap was surfaced: 
The CBOS correction lifecycle (`COMPANY-BRAIN-CBOS.md`) mandates that unreviewed proposals undergo "Workflow/Decision Fabric review → Business Configuration changeset → deterministic validation". 

However, CBOS skills and worker capabilities are currently implemented as flat markdown files inside `EXPADIO_BRAIN_ROOT/03_CAPABILITY/skills/`, rather than dynamic, deterministic database rows. As a result, the skill activation bypassed the "Business Configuration changeset" step entirely, substituting a standard Git PR merge in its place.

If left undocumented, "PR merge substitutes for changeset" will quietly become the unwritten default for all future skill imports, undermining the strict determinism the CBOS lifecycle is supposed to guarantee.

## Proposal

1. **Short term:** Officially update `COMPANY-BRAIN-CBOS.md` to explicitly carve out file-based `EXPADIO_BRAIN_ROOT` artifacts (like skills and agent manifests). Define Git PR approvals as the authorized proxy for the Decision Fabric review for these specific asset types until they are migrated to the database.
2. **Long term:** Plan a migration to move skill manifests out of flat files and into the database (e.g., as `platform.agent_definitions` or similar schemas), so they can genuinely participate in the Business Configuration changeset lifecycle alongside governed lead management rules.

## Expected benefits
- Prevents technical debt from silently accumulating as more skills are imported.
- Restores the integrity and traceability of the CBOS correction lifecycle.

## Risks / trade-offs
- Git PR reviews are less formal and harder to audit non-technically than a true Business Configuration changeset.
- Long-term migration to DB-backed agent definitions represents a significant engineering effort.

## Decision trail
- **2026-09-07** — Proposed by Claude after surfacing the gap during the Pipeline Health Analyst pilot.
