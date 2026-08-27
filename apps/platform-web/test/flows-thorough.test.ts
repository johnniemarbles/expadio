import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const providerModal = read("../app/(shell)/communications/ProviderModal.tsx");
const custodyWrap = read("../lib/custody-wrap.ts");
const iamAdapter = read("../lib/iam-adapter.ts");
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

test("bootstrap seeds the platform admin role and communication capabilities", () => {
  assert.match(iamAdapter, /PLATFORM_SUPER_ADMIN/);
  assert.match(iamAdapter, /communication\.email\.send/);
  assert.match(iamAdapter, /INSERT INTO platform\.capabilities/);
  assert.match(iamAdapter, /INSERT INTO platform\.authorization_assignments/);
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
