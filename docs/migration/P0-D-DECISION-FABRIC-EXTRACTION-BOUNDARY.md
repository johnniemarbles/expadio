# P0-D Decision Fabric Extraction Boundary

**Status:** Source-verified migration boundary

## 1. Source of truth

Initial extraction is pinned to:

- repository: `johnniemarbles/BEMP`
- source commit: `d18e9e674805c2cff95633f34c31896c80b9624f`
- primary source root: `apps/core/src/decision-fabric`

This phase evolves BEMP Decision Fabric into EXPADIO core. It does not create a competing workflow engine.

## 2. Verified BEMP module boundary

The source `DecisionFabricModule` composes:

- Roles
- Packs
- Requirements
- Timers
- Decisions
- Agreements
- Activation
- Cases
- Interests
- Resolver
- Fabric integration
- Case integration
- Fabric catalogue

Source path:

`apps/core/src/decision-fabric/decision-fabric.module.ts`

The source is currently NestJS-composed. EXPADIO extraction must separate portable domain contracts/engines from NestJS transport/composition concerns.

## 3. Verified portable domain concepts

`apps/core/src/decision-fabric/fabric.types.ts` already defines business-domain concepts worth promoting rather than rewriting, including:

- commercial relationship families/types
- workflow role functions
- approval work types
- workflow blueprint lifecycle
- stage types
- workflow blueprint stages
- compliance packs and requirements
- enforcement classes
- cases and case states
- readiness
- decision outcomes
- timers
- rights profiles/grants
- activation blueprints/state
- case relationships
- requirement/evidence states
- compliance gates/holds

These concepts need normalization for EXPADIO naming and package boundaries, but their semantics are source material for the canonical core.

## 4. Verified deterministic engine candidate

`apps/core/src/decision-fabric/blueprint.engine.ts` is a strong first extraction candidate because it is predominantly framework-free domain logic.

Verified responsibilities include:

- mandatory-stage preservation
- stage addition/reorder constraints
- dependency-order validation
- required-stage enablement validation
- deterministic blueprint stage instantiation

The current source contains relationship-specific stage ordering assumptions such as Compliance -> Recommendation -> Decision -> Pre-contract -> Execution -> Rights -> Activation -> Verification. EXPADIO must preserve the generic constraint mechanism while preventing franchise-specific vocabulary from becoming universal core semantics.

## 5. Extraction classification

| Source area | Classification | Target treatment |
| --- | --- | --- |
| `fabric.types.ts` | REFACTOR / PROMOTE | split portable neutral domain contracts from BEMP-specific relationship/compliance catalogue types |
| `blueprint.engine.ts` | PROMOTE FIRST | framework-free workflow blueprint validation/instantiation package |
| `roles/` | PROMOTE / ALIGN | align with EXPADIO Persona != Functional Role != Relationship architecture |
| `resolver/` | PROMOTE LATER | extract deterministic workflow/blueprint resolution after contracts are normalized |
| `cases/` | PROMOTE LATER | case runtime after workflow contracts and persistence boundary exist |
| `decisions/` | PROMOTE LATER | decision work/outcome runtime; preserve authorization and audit boundaries |
| `requirements/` | PROMOTE LATER | generic requirement/gate model; separate compliance vocabulary from mechanics |
| `timers/` | PROMOTE LATER | generic deterministic timer/SLA mechanics |
| `packs/` | SPLIT | generic policy/requirement pack mechanics in core; legal/industry packs remain configuration/vertical data |
| `agreements/` | INTEGRATE LATER | keep separate domain ownership while Decision Fabric orchestrates gates/transitions |
| `activation/` | INTEGRATE LATER | activation orchestration depends on entitlement/provisioning contracts |
| controllers/modules | DO NOT COPY FIRST | rebuild thin composition/API surfaces around extracted core contracts |

## 6. Target P0-D dependency direction

```text
workflow domain contracts
        ↓
blueprint validation / instantiation
        ↓
workflow resolution
        ↓
case runtime + gates + timers
        ↓
decision work
        ↓
agreement / rights / activation orchestration
```

Cross-cutting dependencies:

```text
authorization ─┐
tenancy ────────┼─> Decision Fabric runtime
communication ─┤
audit/events ──┤
business config┘
```

Decision Fabric may call those core capabilities through contracts. They must not depend on BEMP/vertical-specific NestJS modules.

## 7. Core invariants for extraction

1. One canonical EXPADIO workflow/Decision Fabric engine.
2. Vertical workflows are configuration over the engine, not engine forks.
3. Workflow labels are not authorization roles.
4. Workflow participants eventually support USER, ROLE, PERSONA, TEAM, QUEUE, ORGANIZATION, TERRITORY, EXTERNAL_PARTY, SYSTEM and AI_AGENT.
5. Deterministic policy/gate evaluation controls state transitions.
6. AI may recommend or supply structured evidence but cannot bypass deterministic transitions.
7. Published/versioned blueprints are immutable inputs to running cases unless an explicit migration/re-resolution rule applies.
8. Audit/provenance accompanies every material transition.
9. Jurisdiction/compliance requirements are configuration/data over generic requirement/gate mechanics.
10. No source repository is modified during extraction.

## 8. First implementation micro-slices

P0-D proceeds in this order:

- **D1:** portable workflow blueprint/stage contracts only
- **D2:** blueprint validation engine only
- **D3:** blueprint instantiation/version identity only
- **D4:** persistence port and schema/RLS
- **D5:** workflow resolver contract
- **D6:** case runtime/state-transition contract
- later: requirements/gates, timers, assignment participants, decision work, agreement/rights/activation integration

Every slice is independently gated by TypeScript/tests and PostgreSQL contract checks where persistence is involved.

## 9. Explicit non-goals of the first slices

Do not yet migrate:

- NestJS controllers/modules
- brand admin workflow builder UI
- full compliance-pack catalogue
- franchise-specific legal packs
- agreements
- rights grants
- activation provisioning
- AI workflow execution
- queue workers

Those remain source-referenced until the neutral workflow spine is stable.
