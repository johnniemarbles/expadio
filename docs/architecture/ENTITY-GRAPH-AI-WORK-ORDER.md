# Entity Graph — AI Agent Work Order

**Baseline commit:** apply after `df774541` (Lead Management audit baseline)  
**Design authority:** `ENTITY-GRAPH-DESIGN.md` (read before touching any file)  
**Test gate:** all 33 domain tests pass; DB soak passes against real PostgreSQL

---

## Standing rules

1. **Do not modify `platform.organizations` or `platform.organization_closure`.**  
   Both are preserved as compatibility read models. Entity nodes are additive;
   they do not replace the organization/workspace model.

2. **Do not add a `parent_node_id` column to `entity_nodes`.**  
   Structure lives in `entity_relationships` edges, not in a tree column.
   If you find yourself adding parent_node_id, stop — you are recreating the
   problem this migration sequence is solving.

3. **Do not use `entity_relationships.relationship_type = 'LEGACY'` as an
   authorization input.** LEGACY rows require manual reclassification. Any
   authorization predicate that accepts LEGACY is a security defect.

4. **The genesis bootstrap function (`platform.bootstrap_tenant_genesis`) is the
   ONLY path that creates a TENANT_OWNER membership and BRAND_HQ node atomically.**
   Do not add a second path. If a route needs to create these, it calls this function.

5. **Purpose-specific closure functions are the authorization primitive.**
   Do not write `SELECT * FROM entity_nodes WHERE tenant_id = $1` for authorization.
   Write `SELECT * FROM platform.governance_closure($node_id)` (or commercial,
   territorial, operational) and check whether the target node appears in the result.

---

## WO-E1 — Apply migrations

Apply in exact sequence. Do not reorder.

```
infra/db/migrations/0120_entity_nodes.sql
infra/db/migrations/0121_entity_relationships_governed.sql
infra/db/migrations/0122_legal_entities_location_units.sql
infra/db/migrations/0123_ownership_interests.sql
infra/db/migrations/0124_closure_functions.sql
infra/db/migrations/0125_genesis_bootstrap.sql
```

**Check:** `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/db/migrations/0120_entity_nodes.sql`
through 0125 — all exit 0, no ERROR lines in output.

After applying all six:

```sql
-- Verify RLS is on all new tenant-scoped tables:
SELECT * FROM platform.tenant_scoped_tables_missing_rls();
-- Must return 0 rows. If any row is returned, add the missing policy before proceeding.

-- Verify the BRAND_HQ uniqueness constraint:
-- (insert two BRAND_HQ nodes for the same tenant — second must fail)
```

---

## WO-E2 — Register the entity package

1. Create `packages/entity/` with the provided source files:
   ```
   packages/entity/src/index.ts
   packages/entity/src/node.ts
   packages/entity/src/relationship.ts
   packages/entity/src/legal-entity.ts
   packages/entity/src/location-unit.ts
   packages/entity/src/ownership-interest.ts
   packages/entity/src/closure.ts
   packages/entity/src/genesis.ts
   packages/entity/src/errors.ts
   packages/entity/test/entity-proof-gates.test.ts
   ```

2. Register in root `tsconfig.json` paths:
   ```json
   "@expadio/entity": ["packages/entity/src/index.ts"]
   ```

3. Add to root `package.json` workspaces if not already present.

**Check:** `node --experimental-strip-types --test packages/entity/test/entity-proof-gates.test.ts`
→ 33 tests pass, 0 fail.

---

## WO-E3 — Genesis bootstrap API route

Create: `apps/platform-web/app/api/bootstrap/genesis/route.ts`

This route:
- Calls `resolveRequestContext()` — but does NOT require `requireStepUp()` (the
  user has no membership yet, so step-up auth cannot be completed)
- Calls the `platform.bootstrap_tenant_genesis()` DB function
- Returns 201 on first success, 200 on idempotent retry (same subject)
- Returns 409 ALREADY_BOOTSTRAPPED when the tenant is already bootstrapped
- Returns 409 GENESIS_CLAIMED when a different subject already claimed
- Returns 409 GENESIS_EXPIRED when the tenant already has active entities

**Request body:**
```typescript
{
  brandDisplayName: string;    // 1–255 chars
  idempotencyKey?: string;     // optional UUID
}
```

**Response (201/200):**
```typescript
{
  success: true;
  claimId: string;
  bootstrapState: string;
  rootEntityId: string;
  alreadyExisted: boolean;
}
```

**Check:** Two requests with the same `idempotencyKey` and subject return the same
`rootEntityId`. A third request from a different subject after the first returns 409.

---

## WO-E4 — Entity node API routes

Create the following routes under `apps/platform-web/app/api/entities/`:

### `GET /api/entities` — list entity nodes for tenant
- Resolves tenant context
- Supports `?nodeType=UNIT` filter
- Returns paginated list of `EntityNode` objects (no internal IDs exposed in shape)

### `POST /api/entities` — create entity node
- Requires `requireStepUp()`
- Validates with `validateCreateEntityNode()`
- Prevents creating a second BRAND_HQ if one already exists (409)
- Returns 201 with the created node

### `GET /api/entities/[nodeId]` — get single node
- Tenant-scoped (RLS enforces)
- Returns node + any legal entity overlay + location unit overlay in a single response

### `POST /api/entities/[nodeId]/dissolve` — dissolve a node
- Requires `requireStepUp()`
- Status transition only: sets `status = 'DISSOLVED'`, `dissolved_at`, `dissolved_by`
- Returns 409 if node is already dissolved

**Do NOT create DELETE routes.** Nodes are dissolved, not deleted.

---

## WO-E5 — Relationship edge API routes

Create under `apps/platform-web/app/api/entities/[nodeId]/relationships/`:

### `GET` — list relationships for a node
- Returns active edges where the node is source or target
- Supports `?direction=source|target&type=COMMERCIAL_PARENT` filters

### `POST` — create a new relationship edge
- Validates with `validateCreateRelationship()`
- Rejects LEGACY type (400)
- DB cardinality trigger will reject singleton violations — catch and return 409 with a clear message:
  `"This node already has an active COMMERCIAL_PARENT. Terminate it before adding a new one."`
- Dual-control: for `GOVERNANCE_PARENT` edges involving a BRAND_HQ node, require `approvedBy` in the body

### `POST /[relationshipId]/terminate` — terminate an active edge
- Sets `effective_to` to today or a supplied date
- Sets `status = 'TERMINATED'`
- Returns 409 if already terminated

---

## WO-E6 — Database soak test

Create: `infra/db/tests/entity_graph_soak.test.sql`

This file must test every proof gate that requires a real database:

```sql
-- Gate 1: cross-tenant isolation
-- Insert entity node for tenant A; verify tenant B RLS cannot see it.

-- Gate 2: BRAND_HQ uniqueness
-- Insert first BRAND_HQ → succeeds. Insert second → must fail.

-- Gate 3: Dual-parent location
-- Create UNIT node.
-- Add COMMERCIAL_PARENT edge from MULTI_UNIT → UNIT.
-- Add TERRITORIAL_JURISDICTION edge from STATE_MASTER → UNIT.
-- Both edges must coexist. Query each independently.

-- Gate 4: MULTI_UNIT operator spans state masters
-- Create UNIT-A (territory of STATE_MASTER-1) and UNIT-B (territory of STATE_MASTER-2).
-- Add COMMERCIAL_PARENT from MULTI_UNIT to both units.
-- commercial_closure(MULTI_UNIT) must return both units.
-- territorial_closure(STATE_MASTER-1) must return UNIT-A only, not UNIT-B.

-- Gate 5: STATE_MASTER sees its territory, not unrelated units
-- territorial_closure(STATE_MASTER-1) must NOT include UNIT-B.
-- node_is_reachable(STATE_MASTER-1, UNIT-B, 'TERRITORIAL') must return false.

-- Gate 6: Cardinality enforcement
-- Try to insert a second active COMMERCIAL_PARENT edge for the same target node.
-- Must raise the cardinality violation exception.

-- Gate 7: Ownership interest enforcement
-- Insert Partner A (60%), Partner B (50%) for the same owned node → must fail.
-- Insert Partner A (60%), Partner B (40%) → must succeed.
-- Try to insert overlapping period for same owner → must fail.

-- Gate 8: Genesis claim race condition
-- Two concurrent INSERTs for the same tenant_id → one must win, one must fail
-- (or the function must return the same result for the winner on retry).

-- Gate 9: Genesis authority expires after root entity created
-- After bootstrap_tenant_genesis() sets root_entity_id,
-- genesis_claims.root_entity_id IS NOT NULL.
-- A second call with the same subject must return ALREADY_BOOTSTRAPPED.

-- Gate 10: organization_closure still works (compatibility)
-- Existing organization queries produce the same results as before.
-- This is a regression gate: the entity graph must not break legacy queries.

-- Gate 11: RLS drift
-- SELECT * FROM platform.tenant_scoped_tables_missing_rls() returns 0 rows.
```

**Check:** `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/db/tests/entity_graph_soak.test.sql`
prints only PASS notices and exits 0. Any FAIL notice is a blocking defect.

---

## What NOT to do

- Do not add `organization_id` as a foreign key on `entity_nodes` as required.
  It is already optional and nullable by design.
- Do not create a `/api/entities/closure` route that accepts a generic
  `closureType` parameter and returns any result. Authorization closures are
  called internally, not exposed as a general-purpose graph query endpoint.
- Do not add a `relationship_key` alias column that accepts free-form strings.
  The LEGACY type exists for migrated rows only.
- Do not use `ownership_interests` for COMMERCIAL_PARENT modelling.
  Ownership is economics (who holds title). Commercial parent is authority
  (who the royalty flows through). They are different concepts.
