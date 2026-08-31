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

The superseded `artifacts/expadio-brand-dashboard.html` is removed from the draft
tip and is recoverable from prior commits. No later Wave 1+2 fixture was supplied
for this correction; no replacement was invented.

## Dual-shell correction — verification pending at push

Nine new scope-contract tests cover both audiences, explicit unresolved values,
T/B/L selection, pack/residency independence, storage-ID rejection and navigation.
Three source regression tests check removal of the Platform-to-lab link and old
HTML and require explicit lab labeling.

The local execution environment disconnected before these new tests or the 38
read-slice regressions could run. Prior local green results above belong to
`0c11284`, not to this correction. Check current-head CI before further work.

Run from the repository root:

```sh
node --experimental-strip-types --test packages/tenancy/test/*.test.ts
node --experimental-strip-types --test apps/platform-web/test/tenant-audience-boundary.test.ts apps/platform-web/test/tenant-read-model.test.ts
```

These checks do not prove Platform PII isolation, resolved T/B/L ownership,
pack/residency-independent database counts, role homes, real location scope or
authenticated browser e2e. See [remaining gates](shared-scope-contract.md).

