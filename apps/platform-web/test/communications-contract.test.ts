import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/(shell)/communications/page.tsx", import.meta.url), "utf8");
const providerRoute = readFileSync(new URL("../app/api/communications/providers/route.ts", import.meta.url), "utf8");
const providerDetailRoute = readFileSync(new URL("../app/api/communications/providers/[key]/route.ts", import.meta.url), "utf8");
const providerModal = readFileSync(new URL("../app/(shell)/communications/ProviderModal.tsx", import.meta.url), "utf8");
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
const templatesRoute = readFileSync(new URL("../app/api/communications/templates/route.ts", import.meta.url), "utf8");
const providersRoute = readFileSync(
  new URL("../app/api/communications/providers/route.ts", import.meta.url),
  "utf8",
);

test("communications dashboard is backed by live APIs", () => {
  assert.match(page, /fetchApi<CommunicationOverview>\(`\/api\/communications\/overview\$\{q\}`\)/);
  assert.match(page, /fetchApi<ConnectorListItem\[]>\(`\/api\/communications\/providers\$\{q\}`\)/);
  assert.match(page, /fetchApi<FleetHealthItem\[]>\(`\/api\/communications\/fleet\$\{q\}`\)/);
  assert.match(dashboard, /overview\.totals\.deliveries/);
  assert.match(dashboard, /overview\.channels\.map/);
});

test("communications overview remains tenant-scoped and does not expose recipient addresses", () => {
  assert.match(overviewRoute, /WHERE tenant_id = \$1/);
  assert.doesNotMatch(overviewRoute, /recipient_key/);
  assert.doesNotMatch(overviewRoute, /SELECT[^;]*address/is);
});

test("dashboard and APIs do not fabricate operational records", () => {
  const sources = [dashboard, fleetRoute].join("\n");
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


test("provider registration is a real API-backed flow", () => {
  assert.match(providerRoute, /export async function POST/);
  assert.match(providerRoute, /INSERT INTO platform\.connectors/);
  assert.match(providerRoute, /INSERT INTO platform\.connector_credentials/);
  assert.match(providerRoute, /credentialRef must be an external secret reference/);
  assert.match(providerDetailRoute, /export async function DELETE/);
  assert.doesNotMatch(providerDetailRoute, /Mock connector status updated/);
  assert.match(providerModal, /fetch\(`\/api\/communications\/providers\$\{window\.location\.search\}`/);
  assert.match(dashboard, /<ProviderModal/);
  assert.match(dashboard, /setIsProviderModalOpen\(true\)/);
});


test("platform template creation requires governed platform authority", () => {
  assert.match(templatesRoute, /export async function POST/);
  assert.match(templatesRoute, /PLATFORM_SUPER_ADMIN/);
  assert.match(templatesRoute, /role\.ownership_scope = 'PLATFORM'/);
  assert.match(templatesRoute, /set_config\('app\.platform_admin', 'true', true\)/);
  assert.match(templatesRoute, /INSERT INTO platform\.communication_templates/);
  assert.match(templatesRoute, /status\)\s*VALUES \('PLATFORM'/s);
});
