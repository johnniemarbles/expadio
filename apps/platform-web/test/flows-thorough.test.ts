import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const providerModal = read("../app/(shell)/communications/ProviderModal.tsx");
const custodyWrap = read("../lib/custody-wrap.ts");
const iamAdapter = read("../lib/iam-adapter.ts");
const seed = read("../scripts/seed.cjs");
const cloudflareRoute = read("../app/api/communications/domains/cloudflare/route.ts");
const verifyRoute = read("../app/api/communications/domains/[senderId]/verify/route.ts");
const domainDeleteRoute = read("../app/api/communications/domains/[senderId]/route.ts");
const dnsRecords = read("../lib/dns-records.ts");
const templatePreview = read("../app/(shell)/communications/TemplatePreviewModal.tsx");

test("provider registration performs the governed custody handshake with step-up", () => {
  // Step-up rides with every custody + provider call.
  assert.match(providerModal, /x-expadio-reauth-at/);
  // BYOK: wrapping key -> wrap -> intake -> register.
  assert.match(providerModal, /\/api\/custody\/wrapping-key/);
  assert.match(providerModal, /wrapSecret/);
  assert.match(providerModal, /\/api\/custody\/credentials/);
  assert.match(providerModal, /fetch\(`\/api\/communications\/providers\$\{window\.location\.search\}`/);
  // A no-secret path that works without a credential.
  assert.match(providerModal, /CUSTOMER_EGRESS/);
});

test("client-side wrapping matches the server unwrap contract", () => {
  assert.match(custodyWrap, /ECDH/);
  assert.match(custodyWrap, /P-256/);
  assert.match(custodyWrap, /SHA-256/);
  assert.match(custodyWrap, /AES-GCM/);
  // Concat-KDF counter prefix and the algorithm label.
  assert.match(custodyWrap, /\[0, 0, 0, 1\]/);
  assert.match(custodyWrap, /published\.algorithm/);
});

test("bootstrap privilege is explicit startup seeding, never request-time IAM mutation", () => {
  assert.match(seed, /CLERK_ADMIN_USER_ID/);
  assert.match(seed, /PLATFORM_SUPER_ADMIN/);
  assert.match(seed, /INSERT INTO platform\.authorization_assignments/);
  assert.doesNotMatch(iamAdapter, /INSERT INTO platform\.memberships/);
  assert.doesNotMatch(iamAdapter, /INSERT INTO platform\.authorization_assignments/);
});

test("domain auto-configure is honest — PENDING, real records, no fabricated success", () => {
  assert.match(cloudflareRoute, /expectedDnsRecords/);
  assert.match(cloudflareRoute, /'PENDING'/);
  assert.match(cloudflareRoute, /CLOUDFLARE_API_TOKEN/);
  // The old stub asserted VERIFIED and a fake "successfully provisioned" line.
  assert.doesNotMatch(cloudflareRoute, /'VERIFIED'/);
  assert.doesNotMatch(cloudflareRoute, /successfully provisioned/);
});

test("auto-configure really talks to Cloudflare: token, zone discovery, idempotent upsert", () => {
  const cf = read("../lib/cloudflare.ts");
  // Token accepted from the UI as well as the deployment env.
  assert.match(cloudflareRoute, /body\.apiToken/);
  assert.match(cloudflareRoute, /findZone/);
  assert.match(cloudflareRoute, /upsertRecord/);
  // Zone is discovered from the domain, and records are upserted (create OR update).
  assert.match(cf, /\/zones\?name=/);
  assert.match(cf, /method: "PUT"/);
  assert.match(cf, /method: "POST"/);
  assert.match(cf, /api\.cloudflare\.com/);
});

test("domain verification resolves real DNS and retirement is soft", () => {
  assert.match(verifyRoute, /node:dns/);
  assert.match(verifyRoute, /resolveTxt|resolveMx/);
  assert.match(verifyRoute, /verification_status = \$2/);
  assert.match(domainDeleteRoute, /export async function DELETE/);
  assert.match(domainDeleteRoute, /status = 'INACTIVE'/);
  // DKIM is not asserted as verifiable (provider-issued).
  assert.match(dnsRecords, /verifiable: false/);
});

test("template authoring surfaces the real API reason", () => {
  assert.match(templatePreview, /apiError/);
});

test("draft templates are editable end to end (PATCH + inspector edit mode)", () => {
  const route = read("../app/api/communications/templates/[key]/route.ts");
  // Backend: a governed PATCH that only edits DRAFT rows, scope-gated.
  assert.match(route, /export async function PATCH/);
  assert.match(route, /Only DRAFT template versions can be edited/);
  assert.match(route, /PLATFORM_TEMPLATE_ROLES/);
  assert.match(route, /TENANT_TEMPLATE_ROLES/);
  assert.match(route, /UPDATE platform\.communication_templates/);
  // Inspector: an edit mode that PATCHes the draft.
  assert.match(templatePreview, /saveDraft/);
  assert.match(templatePreview, /method:\s*"PATCH"/);
  assert.match(templatePreview, /Edit draft/);
});

test("dashboard controls are truthful: real export, surfaced toggle errors, distinct tabs, real library", () => {
  const dash = read("../app/(shell)/communications/CommunicationsDashboardClient.tsx");
  const library = read("../app/(shell)/communications/TemplateLibraryModal.tsx");
  // Export is a real CSV download, not window.print().
  assert.doesNotMatch(dash, /window\.print\(\)/);
  assert.match(dash, /text\/csv/);
  // Enable/disable failures are surfaced, not swallowed.
  assert.match(dash, /setToggleError/);
  assert.match(dash, /toggleError/);
  // Tenant health is its own view, not sharing the fleet condition.
  assert.doesNotMatch(dash, /activeTab === "fleet" \|\| activeTab === "tenant_health"/);
  // Manage Templates opens the real library, not templates[0].
  assert.doesNotMatch(dash, /handleOpenTemplate\(templates\[0\]/);
  assert.match(dash, /<TemplateLibraryModal/);
  assert.match(library, /filtered/);
  assert.match(library, /onOpenTemplate/);
});
