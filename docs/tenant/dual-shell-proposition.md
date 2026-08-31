# Dual-shell proposition — accepted shape

Status: Brand host kernel plus same-origin `/brand` fallback. Platform product APIs locked to shared nav. Next Brand app is not a separate deploy. Not merged.
Hosts: `platform.expadio.com` (Platform), `app.expadio.com` (Brand). Fallback: `/brand/*` with Brand chrome.

## This increment

- Platform product nav = `SHELL_NAVIGATION.platform` via `SHELL_PLATFORM_SECTIONS`.
- Overview / context / workspaces use generic errors and `private, no-store`.
- PII contract: no customer email/phone/full_name on Platform product payloads or logs.
- CS-104 journey contract exists as observation-only. No executor call from Brand.

## Still open

1. Separate Brand Next deploy on `app.expadio.com` (fallback is not that host).
2. Runtime PII proof on deployed logs/caches and authenticated e2e.
3. Observed Brand case → SCHEDULE → CREATE_TASK → COMMUNICATE → delivery.
