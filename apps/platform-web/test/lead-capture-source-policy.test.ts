import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const ingress = read('../app/api/lead-capture/public/[sourceId]/route.ts');
const publicHttp = read('../lib/lead-capture-public-http.ts');

test('public source lookup normalizes persisted publication policy', () => {
  assert.match(publicHttp, /metadata/);
  assert.match(publicHttp, /normalizeCaptureSourcePublicationConfig\(row\.metadata\?\.publicationConfig \?\? \{\}\)/);
  assert.match(publicHttp, /publication_config/);
});

test('public ingress rejects submissions outside the source policy before persistence', () => {
  assert.match(ingress, /captureSubmissionAllowedBySourceConfig\(source\.publication_config, submittedInterest\)/);
  assert.match(ingress, /CAPTURE_SOURCE_INTEREST_NOT_ALLOWED/);
  const policyGate = ingress.indexOf('captureSubmissionAllowedBySourceConfig');
  const captureInsert = ingress.indexOf('INSERT INTO platform.lead_capture_leads');
  assert.ok(policyGate >= 0 && captureInsert > policyGate);
});

test('generic sources remain generic and cannot accept interest payloads', () => {
  assert.match(ingress, /submittedInterest/);
  assert.match(publicHttp, /normalizeCaptureSourcePublicationConfig/);
});
