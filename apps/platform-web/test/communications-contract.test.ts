import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/(shell)/communications/page.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(
  new URL("../app/(shell)/communications/CommunicationsDashboardClient.tsx", import.meta.url),
  "utf8",
);
const overviewRoute = readFileSync(
  new URL("../app/api/communications/overview/route.ts", import.meta.url),
  "utf8",
);
const fleetRoute = readFileSync(
  new URL("../app/api/communications/fleet/route.ts", import.meta.url),
  "utf8",
);
const providersRoute = readFileSync(
  new URL("../app/api/communications/providers/route.ts", import.meta.url),
  "utf8",
);

test("communications dashboard is backed by live APIs", () => {
  assert.match(page, /fetchApi<CommunicationOverview>\("\/api\/communications\/overview"\)/);
  assert.match(page, /fetchApi<ConnectorListItem\[]>\("\/api\/communications\/providers"\)/);
  assert.match(page, /fetchApi<FleetHealthItem\[]>\("\/api\/communications\/fleet"\)/);
  assert.match(dashboard, /overview\.totals\.deliveries/);
  assert.match(dashboard, /overview\.channels\.map/);
});

test("communications overview remains tenant-scoped and does not expose recipient addresses", () => {
  assert.match(overviewRoute, /WHERE tenant_id = \$1/);
  assert.doesNotMatch(overviewRoute, /recipient_key/);
  assert.doesNotMatch(overviewRoute, /SELECT[^;]*address/is);
});

test("dashboard and APIs do not fabricate operational records", () => {
  const sources = [dashboard, fleetRoute, providersRoute].join("\n");
  assert.doesNotMatch(sources, /fallback/i);
  assert.doesNotMatch(sources, /Northstar Logistics|Dentex Canada|Urban Realty|Nova TPA/);
  assert.doesNotMatch(sources, /18\.4M|98\.1%|172 production-ready/);
  assert.match(dashboard, /No communication providers configured/);
  assert.match(dashboard, /No telemetry records captured/);
  assert.match(dashboard, /No recent delivery failures/);
});

test("provider mutations remain limited to governed connector controls", () => {
  assert.match(dashboard, /\/api\/communications\/providers\/\$\{encodeURIComponent\(connectorKey\)\}/);
  assert.doesNotMatch(dashboard, /Send now|Send test/);
});
