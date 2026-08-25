# P0 Provider Registry Runtime

**Status:** Implementation slice

## Purpose

Wire the existing provider/connector registry to PostgreSQL runtime access without weakening the credential boundary established in P0 Provider Registry Persistence.

## Repository contracts

`@expadio/provider-registry/repository` adds:

- `ProviderRegistryRepository`
- `ConnectorCredentialRepository`
- `SecretResolver`
- `routeConnectorFromRegistry()`

Normal connector discovery and credential-reference lookup are intentionally separate interfaces.

## Tenant-facing repository

`PostgresProviderRegistryRepository` loads:

- connector identity/provider metadata
- ownership scope
- capability support
- region/residency/compliance tags
- health
- priority/fallback state
- effective tenant routing policy

It never reads `platform.connector_credentials`.

The tenant application DB role receives SELECT on routing metadata but not on connector credential references.

## Infrastructure-only credential repository

`PostgresConnectorCredentialRepository` loads a `credential_ref` only after connector selection.

Even if the concrete infrastructure role has elevated database privileges, the query explicitly requires that the connector is either:

- platform-owned, or
- owned by the requested tenant

This is defense in depth against accidental cross-tenant credential-reference resolution.

## Secret resolver

`SecretResolver` is the external secret-manager boundary.

It accepts only a validated `CredentialReference` and returns ephemeral resolved secret material to the provider adapter that needs it.

Resolved secret values are never persisted by EXPADIO domain tables.

## Runtime flow

```text
request transaction / tenant RLS
  -> load connectors + routing policy
  -> pure routeConnector rules
  -> selected connector
  -> infrastructure credential repository
  -> credential_ref
  -> SecretResolver (Vault/KMS/provider secret service)
  -> provider adapter
```

## CI evidence

TypeScript tests verify:

- connector metadata mapping excludes credentials
- routing policy mapping
- credential lookup includes explicit tenant/platform ownership predicate
- repository-driven routing delegates to the pure deterministic router

PostgreSQL smoke tests verify:

- tenant A sees only its own routing policy
- tenant application role has no SELECT privilege on `platform.connector_credentials`
- all existing migration/RLS/append-only checks remain green

## Non-goals

This slice does not implement a concrete Vault/KMS provider, provider SDK adapter, health worker, cost-based router, or secret cache.

## Next boundary

- persisted authorization assignments / restrictions / delegations
- Decision Fabric persistence and immutable/auditable decision history
- application composition root joining context + authorization + capability + routing
