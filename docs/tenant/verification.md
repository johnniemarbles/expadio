# Read-slice verification

Wave 1 source contract on `feat/tenant-product-foundation` is closed against CI. Keep #499 draft.

## Current head

CI green on this branch: `check`, `integration`, `postgres-contract`, `verify-architecture-baseline`.

These are **not** a Railway preview, authenticated browser e2e, command idempotency/SoD verification or load test. No production migration was run. `/brand` is a same-origin fallback, not `app.expadio.com`.

## Reproduce

From the repository root:

```sh
node --experimental-strip-types --test packages/tenancy/test/*.test.ts
node --experimental-strip-types --test apps/platform-web/test/tenant-audience-boundary.test.ts apps/platform-web/test/tenant-read-model.test.ts
```

From `apps/platform-web`:

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

## Next proof, not next source

See [platform-pii-proof.md](platform-pii-proof.md) and [shared-scope-contract.md](shared-scope-contract.md).
Runtime logs/caches require a Railway preview of platform-web. Do not invent a live `DELIVERED` row. Do not merge lab APIs into the product nav.
