import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const listRoute = read("../app/api/communications/domains/route.ts");
const verifyRoute = read("../app/api/communications/domains/[senderId]/verify/route.ts");
const modal = read("../app/(shell)/communications/DomainConfigModal.tsx");

test("domain list exposes DNS requirements without fabricated observations", () => {
  assert.match(listRoute, /expectedDnsRecords/);
  assert.match(listRoute, /verifiable: record\.verifiable/);
  assert.doesNotMatch(listRoute, /status: isVerified \? ['"]VERIFIED['"] : ['"]PENDING['"]/);
  assert.doesNotMatch(listRoute, /p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC3/);
});

test("verification checks required DNS values, not merely record existence", () => {
  assert.match(verifyRoute, /requiredTokens\(spec\.value\)/);
  assert.match(verifyRoute, /required\.every\(\(token\) => tokens\.has\(token\)\)/);
  assert.match(verifyRoute, /requiredDirectives\.every/);
  assert.match(verifyRoute, /normalizeHost\(record\.exchange\) === requiredExchange/);
  assert.match(verifyRoute, /record\.priority === spec\.priority/);
  assert.match(verifyRoute, /filter\(\(spec\) => spec\.verifiable\)/);
  assert.doesNotMatch(verifyRoute, /specs\.map\(checkRecord\)/);
});

test("provider-issued DKIM can never be mislabeled as a missing DNS observation", () => {
  assert.match(modal, /if \(!record\.verifiable\) return ['"]PROVIDER ISSUED['"]/);
  assert.match(modal, /recordStatusClass/);
  assert.match(modal, /styles\.recordStatusVerified/);
  assert.match(modal, /NOT CHECKED/);
  assert.match(modal, /MISSING/);
});
