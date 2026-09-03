import assert from 'node:assert/strict';
import test from 'node:test';
import type { CaptureInterestSubmissionInput } from '../src/contract.ts';
import { normalizeInterestSubmission } from '../src/normalize.ts';

const hasCode = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

const franchiseSubmission: CaptureInterestSubmissionInput = {
  contact: { email: 'owner@example.com', firstName: 'Ada', lastName: 'Owner' },
  consent: [{ channel: 'EMAIL', purpose: 'ENQUIRY_FOLLOW_UP', granted: true, textVersion: 'v1' }],
  attribution: { pageUrl: 'https://brand.example/franchise', utmSource: 'partner' },
  interest: {
    interestType: 'FRANCHISEE',
    opportunityType: 'MULTI_UNIT',
    person: {
      firstName: 'Ada',
      lastName: 'Owner',
      email: 'owner@example.com',
      countryCode: 'CA',
    },
    business: {
      hasExistingBusiness: true,
      companyName: 'Owner Holdings Ltd',
      yearsInBusiness: 8,
      numberOfLocations: 3,
    },
    locationSought: [{
      countryCode: 'CA',
      regionOrState: 'ON',
      city: 'Toronto',
      territoryType: 'METRO',
      numberOfLocations: 3,
    }],
    investmentBudgetMinorUnits: 15000000,
    availableLiquidCapitalMinorUnits: 7500000,
    managementExperienceYears: 10,
    numberOfUnitsDesired: 3,
    preferredOpeningTimeline: '6_MONTHS',
  },
};

test('strict interest submission preserves Tier 1 + Tier 2 payload on the wire shape', () => {
  const normalized = normalizeInterestSubmission(franchiseSubmission);
  assert.equal(normalized.interest?.interestType, 'FRANCHISEE');
  if (normalized.interest?.interestType !== 'FRANCHISEE') assert.fail('expected franchise interest');
  assert.equal(normalized.interest.opportunityType, 'MULTI_UNIT');
  assert.equal(normalized.interest.locationSought[0]?.city, 'Toronto');
  assert.equal(normalized.interest.availableLiquidCapitalMinorUnits, 7500000);
  assert.equal(normalized.attribution.utmSource, 'partner');
  assert.equal(normalized.consent[0]?.purpose, 'ENQUIRY_FOLLOW_UP');
});

test('strict interest submission rejects omitted consent, attribution, or interest at runtime', () => {
  assert.throws(
    () => normalizeInterestSubmission({ ...franchiseSubmission, consent: undefined } as never),
    hasCode('CAPTURE_CONSENT_REQUIRED'),
  );
  assert.throws(
    () => normalizeInterestSubmission({ ...franchiseSubmission, attribution: undefined } as never),
    hasCode('CAPTURE_ATTRIBUTION_REQUIRED'),
  );
  assert.throws(
    () => normalizeInterestSubmission({ ...franchiseSubmission, interest: undefined } as never),
    hasCode('CAPTURE_INTEREST_REQUIRED'),
  );
});

test('generic capture remains backwards compatible', () => {
  const normalized = normalizeInterestSubmission(franchiseSubmission);
  assert.ok(Array.isArray(normalized.consent));
  assert.equal(typeof normalized.attribution, 'object');
});
