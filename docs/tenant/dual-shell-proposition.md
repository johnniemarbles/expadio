# Dual-shell proposition — accepted shape

Status: Brand host kernel plus same-origin `/brand` fallback. Platform product APIs locked to shared nav. CS-104 observation routes exist. Next Brand app is not a separate deploy. Not merged.
Hosts: `platform.expadio.com` (Platform), `app.expadio.com` (Brand). Fallback: `/brand/*` with Brand chrome.

## This increment

- Platform product nav = `SHELL_NAVIGATION.platform` via `SHELL_PLATFORM_SECTIONS`.
- Overview / context / workspaces / journey-correlation use generic errors and `private, no-store`.
- PII contract: no customer email/phone/full_name on Platform product payloads or logs.
- Brand `GET /brand/api/journey` returns `emptyBrandJourneyObservation` after the same T/B/L + membership gate as customers.
- Platform `GET /api/journey-correlation` returns only `platformViewOfJourney` (correlation, optional case id).
- `observeBrandJourneyFromFacts` refuses SCHEDULE/CREATE_TASK sent or delivered. No executor is queried yet.

## Still open

1. Separate Brand Next deploy on `app.expadio.com` (fallback is not that host).
2. Runtime PII proof on deployed logs/caches and authenticated e2e.
3. Observed Brand case → SCHEDULE → CREATE_TASK → COMMUNICATE → delivery from frozen executor records.
