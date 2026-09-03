# EXPADIO Entity Graph — Design Specification

**Status:** Approved for implementation  
**Supersedes:** free-form `entity_relationships.relationship_key` (migration 0063)  
**Preserves:** `platform.organizations`, `platform.organization_closure` (compatibility read layer)  
**Migration range:** 0120–0125

---

## 1. Why this exists

`platform.organizations` currently carries every meaning a multi-entity franchise network
needs: it is simultaneously a legal incorporation, a franchise territory, a physical
location, a brand hierarchy node, and an authorization workspace. When one table carries
every meaning, no question about authority can be answered precisely.

A single franchise restaurant location must be able to answer all of these simultaneously:
- Who is my **commercial parent**? (Multi-Unit Operator — royalty flows)
- Who has **territorial jurisdiction** over me? (State Master — development rights)
- Who is my **governance authority**? (Country / Brand HQ — compliance, standards)
- Where am I **physically located**? (Province → State → Country — geography)

The current `parent_organization_id` tree gives one answer. This model gives four.

---

## 2. Five entity node types

Each is a distinct table. They are NOT subtypes of organization — they are parallel
first-class objects that organizations may reference, but do not replace.

### 2.1 Enterprise Profile (already exists — 0113)
Tenant-level brand configuration. One per tenant. Not a hierarchy participant.
Governs the whole tenant: industry pack, brand identity, logo, terminology.

### 2.2 Entity Node (`platform.entity_nodes`) — NEW
The typed actor in the graph. Every participant in commercial, territorial, governance,
and geographic relationships is an entity node.

Node types (check-constrained text):
```
BRAND_HQ          — root franchisor / brand authority
COUNTRY           — country-level master entity (may hold development rights)
STATE_MASTER      — state/province development rights holder
MULTI_UNIT        — multi-unit operator (commercial fleet owner)
UNIT              — individual operating location / franchise unit
LEGAL_ENTITY      — incorporated business (holds contracts, has registration)
LOCATION          — physical site with address and geography
JV_PARTNER        — joint venture participant (economic interest only)
```

Key invariants:
- Every node belongs to exactly one tenant (tenant_id, RLS-enforced)
- A node has a `node_type` that does not change after creation
- A node has a `display_name`, optional `external_ref` (ERP/legal ID), and `status`
- A node is NOT an organization — it has no memberships, no Clerk group

### 2.3 Legal Entity (`platform.legal_entities`) — NEW
Incorporated business actor. Overlays an entity node.

Carries:
- Registered legal name
- Registration number and jurisdiction
- Legal form (LLC, Ltd, Corp, Franchise Agreement holder, etc.)
- Incorporation date
- Registered address
- VAT / tax identifier

A UNIT entity node may have a legal entity overlay (franchisee's LLC).
A MULTI_UNIT entity node may have a legal entity overlay (operator company).
Not every node has a legal entity; not every legal entity maps 1:1 to a node.

### 2.4 Location Unit (`platform.location_units`) — NEW
Physical site. Overlays a UNIT or LOCATION entity node.

Carries:
- Street address (structured)
- Latitude / longitude
- Country, state/province, city
- Operating hours (JSONB)
- Timezone
- Status (PLANNED, OPEN, TEMPORARILY_CLOSED, PERMANENTLY_CLOSED)

### 2.5 Ownership Interest (`platform.ownership_interests`) — NEW
Normalized JV economics. Separate from relationship edges because:
- Multiple concurrent owners (percentages must sum to 100%)
- Effective period enforcement
- Share/profit class distinction
- Dividend routing metadata

Not modelled as a relationship edge because edges are binary directed;
ownership is a participation set with cardinality-constrained percentage enforcement.

---

## 3. Relationship edges (`platform.entity_relationships` — EVOLVED)

Migration 0063 created this table with a free-form `relationship_key`.
Migration 0121 evolves it: adds a governed taxonomy via CHECK constraint,
adds cardinality validation, adds required metadata columns.

### 3.1 Six governed relationship types

```
OWNERSHIP              — economic ownership interest (use ownership_interests instead for % splits)
COMMERCIAL_PARENT      — royalty/commercial chain upward
OPERATIONAL_PARENT     — operational reporting upward
TERRITORIAL_JURISDICTION — which authority holds territory rights over this node
GOVERNANCE_PARENT      — compliance, standards, audit authority
LOCATED_IN             — physical geography (unit → state → country)
```

### 3.2 Cardinality rules (enforced by trigger)

| Relationship type       | Cardinality (per target node, per time) |
|-------------------------|-----------------------------------------|
| COMMERCIAL_PARENT       | 0..1 active                             |
| OPERATIONAL_PARENT      | 0..1 active                             |
| TERRITORIAL_JURISDICTION| exactly 1 active (required for UNIT)   |
| GOVERNANCE_PARENT       | 0..1 active                             |
| LOCATED_IN              | 0..1 active per geography level         |
| OWNERSHIP               | 0..N active (sum via ownership_interests)|

An expired edge (effective_to in the past) does not violate cardinality.
Historical edges are preserved and queryable.

### 3.3 Required edge metadata

- `source_node_id`, `target_node_id` — entity_nodes references
- `relationship_type` — CHECK-constrained to the six above
- `effective_from` — date, defaults to now()
- `effective_to` — date, NULL = currently active
- `status` — ACTIVE | SUPERSEDED | TERMINATED
- `evidence_ref` — text (agreement ID, approval reference, document URL)
- `created_by` — subject_id of the actor who established the edge
- `approved_by` — subject_id of the approving authority (dual-control)
- `notes` — JSONB for extensible provenance metadata

---

## 4. Purpose-specific closure projections

`organization_closure` is preserved as a compatibility read model.
Four new materialized-view–style functions are added alongside it.

These are SQL functions (not materialized views) initially, to avoid refresh complexity.
They should be converted to materialized views with incremental refresh in Phase 5
once the entity graph is the authoritative source.

```sql
platform.governance_closure(root_node_id uuid)   -- GOVERNANCE_PARENT edges
platform.commercial_closure(root_node_id uuid)    -- COMMERCIAL_PARENT edges
platform.territorial_closure(node_id uuid)        -- TERRITORIAL_JURISDICTION edges
platform.operational_closure(root_node_id uuid)   -- OPERATIONAL_PARENT edges
```

Each function returns: `(node_id, depth, path, node_type, display_name)`

RLS policies and application queries should call the purpose-specific closure,
never a generic "get all descendants" function that conflates edge types.

---

## 5. Genesis bootstrap (Phase 1 of reset plan)

A new `platform.genesis_claims` table ensures first-user onboarding
completes without the current membership deadlock.

Bootstrap state machine:
```
REGISTERED → GENESIS_BOOTSTRAPPED → ROOT_ENTITY_CREATED → GOVERNANCE_CONFIGURED → ACTIVE
```

Genesis claim record:
- `tenant_id` (unique — one claim per tenant)
- `claimed_by` (subject_id)
- `claimed_at`
- `root_entity_id` (populated after root entity creation)
- `completed_at` (NULL until ACTIVE state reached)

Genesis authority is valid only while `completed_at IS NULL AND root_entity_id IS NULL`.
Once a root entity exists, genesis authority is automatically expired.
The claim cannot be transferred or reused.

---

## 6. What is NOT changing

`platform.organizations` — preserved. Memberships, Clerk group bindings, and the
authorization workspace model stay on organizations. Entity nodes are not organizations.

`platform.organization_closure` — preserved as compat read layer. Legacy queries
that use it continue to work. The closure is not populated from entity_relationships;
it continues to be populated from organizations.parent_organization_id.

`platform.entity_relationships` — table preserved, evolved by migration 0121.
Existing rows with free-form relationship_key are migrated to `OWNERSHIP` type
or flagged as LEGACY for manual classification.

---

## 7. Migration sequence

| Migration | Content |
|-----------|---------|
| 0120 | `platform.entity_nodes` table + RLS + indexes |
| 0121 | Evolve `platform.entity_relationships`: governed types, cardinality trigger, metadata cols |
| 0122 | `platform.legal_entities` + `platform.location_units` tables + RLS |
| 0123 | `platform.ownership_interests` + enforcement trigger (sum = 100%) |
| 0124 | Purpose-specific closure functions (4 functions) |
| 0125 | Genesis claim table + bootstrap transaction function |

---

## 8. Proof gates (from reset document)

The entity graph implementation is complete only when:

- [ ] A location node can have distinct COMMERCIAL_PARENT and TERRITORIAL_JURISDICTION edges simultaneously
- [ ] A MULTI_UNIT node can hold COMMERCIAL_PARENT edges to units across multiple states
- [ ] A STATE_MASTER node's territorial_closure() returns only its units, not unrelated units
- [ ] A MULTI_UNIT node's commercial_closure() returns its fleet regardless of state
- [ ] Ownership interests enforce sum=100% and no overlapping effective periods
- [ ] Genesis claim is one-time, tenant-scoped: second concurrent claim is rejected
- [ ] Genesis authority expires once root_entity_id is set
- [ ] Existing tenants cannot invoke genesis bootstrap
- [ ] Cross-tenant isolation: entity_nodes from tenant A are invisible to tenant B
- [ ] organization_closure continues to work unchanged for legacy queries
