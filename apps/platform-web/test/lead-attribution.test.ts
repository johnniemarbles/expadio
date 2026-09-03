import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { attributionColumns } from '../lib/lead-attribution.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../infra/db/migrations/0144_lead_attribution_consent.sql');
const ingress = read('../app/api/lead-capture/public/[sourceId]/route.ts');

test('attribution columns are ordered, trimmed, and blanks become null', () => {
  const cols = attributionColumns({
    pageUrl: ' https://x.test/apply ', referrerUrl: '', utmSource: 'newsletter',
    utmMedium: '  ', utmCampaign: 'spring', gclid: 'g123', affiliateKey: 'aff-9',
  });
  assert.equal(cols[0], 'https://x.test/apply'); // pageUrl trimmed
  assert.equal(cols[1], null);                    // empty referrer -> null
  assert.equal(cols[2], 'newsletter');            // utm_source
  assert.equal(cols[3], null);                    // whitespace utm_medium -> null
  assert.equal(cols[4], 'spring');                // utm_campaign
  assert.equal(cols[8], 'g123');                  // gclid
  assert.equal(cols[11], 'aff-9');                // affiliate_key
  assert.equal(cols.length, 12);
});

test('migration stores attribution + consent as append-only, org-scoped evidence', () => {
  assert.match(migration, /CREATE TABLE platform\.lead_attribution_events/);
  assert.match(migration, /CREATE TABLE platform\.lead_consent_records/);
  assert.match(migration, /append-only/);
  assert.match(migration, /lead_attribution_events_append_only/);
  assert.match(migration, /lead_consent_records_append_only/);
  // First/latest touch summary on the person.
  assert.match(migration, /first_touch_at timestamptz/);
  assert.match(migration, /last_touch_at timestamptz/);
  // Org-scoped management + source-bound ingress.
  assert.match(migration, /current_context_can_access_organization/);
  assert.match(migration, /current_public_capture_source_scope/);
});

test('capture ingress persists attribution + consent without failing capture', () => {
  assert.match(ingress, /persistCaptureAttributionAndConsent/);
  assert.match(ingress, /attribution: submission\.attribution/);
  assert.match(ingress, /consent: submission\.consent/);
  assert.match(ingress, /attribution persistence skipped/);
});
