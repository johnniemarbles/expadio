# Dual-shell proposition — accepted shape

Status: Platform + same-origin `/brand` fallback are live on Railway production for Wave 1 observation. Separate Brand deploy on `app.expadio.com` is not live. Not merged.

Hosts: `platform.expadio.com` (Platform), `app.expadio.com` (Brand). Fallback: `/brand/*` with Brand chrome.

## Proven on Railway (this branch)

- Platform nav = `SHELL_NAVIGATION.platform`.
- Provision writes `product_scope_bindings` from operator-supplied T/B/L (0090).
- Brand `/brand?tenant=T-0001&brand=B-0001&location=ALL` authorizes customer reads. Empty list is honest.
- `L-####` customer reads stay closed.
- CS-104 seed writes intents/attempts only (0091). No send. No `communication_deliveries` row.
- Brand Communications: COMMUNICATE/DELIVERY `sent`. Platform correlation read matches. `deliveryClaimed` is false.
- Source PII scanners pass. Railway log files are not read.

## Still open

1. Separate Brand Next deploy on `app.expadio.com`. Fallback is not that host.
2. Railway log/cache grep on a signed-in session.
3. Provider `communication_deliveries.state = DELIVERED` for CS-104.
4. Clerk production keys on the production hostname.
