import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/(shell)/communications/page.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/communications/overview/route.ts", import.meta.url), "utf8");

test("communications UI is backed by the live overview API", () => {
  assert.match(page, /fetchApi<CommunicationOverview>\("\/api\/communications\/overview"\)/);
  assert.doesNotMatch(page, /fixture/i);
});

test("communications overview remains tenant-scoped and does not expose recipient addresses", () => {
  assert.match(route, /WHERE tenant_id = \$1/);
  assert.doesNotMatch(route, /recipient_key/);
  assert.doesNotMatch(route, /SELECT[^;]*address/is);
});

test("sending is not falsely exposed before provider activation", () => {
  assert.match(page, /Sending disabled/);
  assert.doesNotMatch(page, /Send now|Send test/);
});
