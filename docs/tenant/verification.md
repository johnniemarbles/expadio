# Read-slice verification

Local validation for this update:

- 16 unit/contract tests in `test/tenant-read-model.test.ts`.
- 12 isolated PostgreSQL-engine checks: actual membership, CRM, workflow-decision
  and operational-task migrations; NOBYPASSRLS role; tenant and sibling-org
  denial; restricted/expired membership; inconsistent child links; read-only
  enforcement; pooled context cleanup. Dependency tables for events and action
  intents are minimal test fixtures, not execution tests.
- 10 mounted-DOM checks: explicit model, customer sections, empty live records,
  denied/not-found states, query scope propagation and cancellation on navigation.
- Targeted strict TypeScript checking of the tenant UI, read model, contracts,
  model fixture, unit tests and compatibility with the pg Pool client interface.

These are **not** a full monorepo build, browser/mobile accessibility review,
authenticated deployment e2e, command idempotency/SoD verification or load test.
The PR remains draft and no deployment or migration was run.

## Reproduce

With repository dependencies installed, from `apps/platform-web`:

```sh
node --experimental-strip-types --test test/tenant-read-model.test.ts
```

The optional standalone scripts use isolated tooling so production dependencies
and the lockfile do not change. Install `@electric-sql/pglite`, `jsdom` and
`esbuild` in a temporary directory and provide their absolute module entry paths:

```sh
TENANT_PGLITE_MODULE=/absolute/tooling/node_modules/@electric-sql/pglite/dist/index.js node --experimental-strip-types scripts/verify-tenant-read-model.mjs
TENANT_JSDOM_MODULE=/absolute/tooling/node_modules/jsdom/lib/api.js TENANT_ESBUILD_MODULE=/absolute/tooling/node_modules/esbuild/lib/main.js node scripts/verify-tenant-workspace.mjs
```

The DOM harness bundles the actual tenant component with the repository's React
installation. It does not inspect CSS layout, invoke Clerk or contact a real API.
The PostgreSQL harness creates a fresh in-memory engine, seeds test rows and
closes it afterwards; it never connects to an external database.

Before release run the normal monorepo checks and authenticated e2e on a deployed
preview. Verify the database connection role cannot bypass RLS, inspect query
plans for organization-scoped joins, test revoked sessions and memberships,
keyboard focus, mobile tables/navigation and screen-reader announcements.

The supplied HTML is preserved at `artifacts/expadio-brand-dashboard.html` as a
directional prototype only. Its contradictory fixture states/counts are not used
by the implementation.
