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
const connectorActionsModal = readFileSync(
  new URL("../app/(shell)/communications/ConnectorActionsModal.tsx", import.meta.url),
  "utf8",
);
const capacityPanel = readFileSync(
  new URL("../app/(shell)/communications/CapacityPanel.tsx", import.meta.url),
  "utf8",
);
const tracesPanel = readFileSync(
  new URL("../app/(shell)/communications/TracesPanel.tsx", import.meta.url),
  "utf8",
);
const templateComposerModal = readFileSync(
  new URL("../app/(shell)/communications/TemplateComposerModal.tsx", import.meta.url),
  "utf8",
);
const templatePreviewModal = readFileSync(
  new URL("../app/(shell)/communications/TemplatePreviewModal.tsx", import.meta.url),
  "utf8",
);
const providerDetailMutationRoute = readFileSync(
  new URL("../app/api/communications/providers/[key]/route.ts", import.meta.url),
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

test("connector detail mutations resolve the real tenant, not the demo scaffold", () => {
  // G5 — PATCH/DELETE must not hardcode the demo tenant or resolve via auth() directly.
  assert.match(providerDetailMutationRoute, /resolveRequestContext/);
  assert.match(providerDetailMutationRoute, /withTenantClient/);
  assert.doesNotMatch(providerDetailMutationRoute, /00000000-0000-0000-0000-000000000001/);
  assert.doesNotMatch(providerDetailMutationRoute, /@clerk\/nextjs\/server/);
});

test("connector actions surface the governed custody endpoints", () => {
  // The dashboard opens one governed console per connector instead of alert()/confirm().
  assert.match(dashboard, /<ConnectorActionsModal/);
  assert.match(dashboard, /setActiveConnector/);
  assert.doesNotMatch(dashboard, /\balert\(/);
  assert.doesNotMatch(dashboard, /\bconfirm\(/);
  // Blast radius, health and attestation are all read; revocation is the governed POST.
  assert.match(connectorActionsModal, /\/blast-radius/);
  assert.match(connectorActionsModal, /\/health/);
  assert.match(connectorActionsModal, /\/attestation/);
  assert.match(connectorActionsModal, /\/revoke/);
  assert.match(connectorActionsModal, /method:\s*"POST"/);
  // Test send is also a governed connector action rather than a dashboard shortcut.
  assert.match(connectorActionsModal, /\/test-send/);
  assert.match(connectorActionsModal, /Send test/);
  assert.match(connectorActionsModal, /idempotencyKey:\s*`test-\$\{crypto\.randomUUID\(\)\}`/);
  // Step-up (§3.4) rides with destructive and external-send actions.
  assert.match(connectorActionsModal, /x-expadio-reauth-at/);
});

test("capacity tab surfaces planes, quota and the spend breaker", () => {
  assert.match(dashboard, /<CapacityPanel/);
  assert.match(dashboard, /setActiveTab\("capacity"\)/);
  assert.match(capacityPanel, /\/api\/communications\/planes/);
  assert.match(capacityPanel, /\/api\/communications\/quota/);
  assert.match(capacityPanel, /\/api\/communications\/spend/);
  // Editing the spend cap is step-up guarded.
  assert.match(capacityPanel, /method:\s*"PATCH"/);
  assert.match(capacityPanel, /x-expadio-reauth-at/);
});

test("decision traces tab surfaces the trace explorer", () => {
  assert.match(dashboard, /<TracesPanel/);
  assert.match(dashboard, /setActiveTab\("traces"\)/);
  assert.match(tracesPanel, /\/api\/communications\/traces/);
  assert.match(tracesPanel, /\/api\/communications\/traces\/\$\{encodeURIComponent\(traceId\)\}/);
});

test("template authoring lifecycle is wired end to end", () => {
  // Create (POST /templates) is reachable from the library.
  assert.match(dashboard, /<TemplateComposerModal/);
  assert.match(templateComposerModal, /fetch\(`\/api\/communications\/templates\$\{queryString\}`/);
  assert.match(templateComposerModal, /method:\s*"POST"/);
  // Draft version and publish are reachable from the inspector.
  assert.match(templatePreviewModal, /\/versions/);
  assert.match(templatePreviewModal, /\/publish/);
});
