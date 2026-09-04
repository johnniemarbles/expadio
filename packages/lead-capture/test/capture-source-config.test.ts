import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureSubmissionAllowedBySourceConfig,
  listCaptureSourceInterestOptions,
  normalizeCaptureSourcePublicationConfig,
  CaptureSourceConfigError,
} from '../src/capture-source-config.ts';

const hasCode = (code: string) => (error: unknown) => error instanceof CaptureSourceConfigError && error.code === code;

test('interest source config narrows platform registry choices per source', () => {
  const config = normalizeCaptureSourcePublicationConfig({
    captureMode: 'INTEREST',
    publicationMode: 'JS_WIDGET',
    allowedInterests: [
      { interestType: 'FRANCHISEE', opportunityType: 'SINGLE_UNIT' },
      { interestType: 'FRANCHISEE', opportunityType: 'MULTI_UNIT' },
      { interestType: 'AFFILIATE' },
    ],
  });

  assert.equal(config.captureMode, 'INTEREST');
  assert.equal(config.allowedInterests.length, 3);
  assert.deepEqual(config.allowedInterests.map((entry) => entry.interestType), [
    'FRANCHISEE',
    'FRANCHISEE',
    'AFFILIATE',
  ]);
  assert.match(config.allowedInterests[0]?.schemaKey ?? '', /^opportunity:franchise:single-unit:v1$/u);
  assert.equal(
    captureSubmissionAllowedBySourceConfig(config, { interestType: 'FRANCHISEE', opportunityType: 'SINGLE_UNIT' }),
    true,
  );
  assert.equal(
    captureSubmissionAllowedBySourceConfig(config, { interestType: 'DISTRIBUTOR', opportunityType: 'EXCLUSIVE_DISTRIBUTOR' }),
    false,
  );
});

test('interest source config rejects unsupported registry combinations', () => {
  assert.throws(
    () => normalizeCaptureSourcePublicationConfig({
      captureMode: 'INTEREST',
      allowedInterests: [{ interestType: 'FRANCHISEE', opportunityType: 'MASTER_DISTRIBUTOR' }],
    }),
    hasCode('CAPTURE_SOURCE_INTEREST_UNSUPPORTED'),
  );
});

test('source publication mode cannot exceed registry restrictions', () => {
  assert.throws(
    () => normalizeCaptureSourcePublicationConfig({
      captureMode: 'INTEREST',
      publicationMode: 'SOCIAL_LINK',
      allowedInterests: [{ interestType: 'MASTER_FRANCHISEE' }],
    }),
    hasCode('CAPTURE_SOURCE_PUBLICATION_MODE_UNSUPPORTED'),
  );

  const config = normalizeCaptureSourcePublicationConfig({
    captureMode: 'INTEREST',
    publicationMode: 'EMAIL_LINK',
    allowedInterests: [{ interestType: 'MASTER_FRANCHISEE' }],
  });
  assert.equal(config.allowedInterests[0]?.workflowBlueprintKey, 'workflow:franchise:master:v1');
});

test('generic source config remains backwards compatible and cannot carry interest restrictions', () => {
  const generic = normalizeCaptureSourcePublicationConfig({ captureMode: 'GENERIC', publicationMode: 'REST_API' });
  assert.equal(generic.allowedInterests.length, 0);
  assert.equal(captureSubmissionAllowedBySourceConfig(generic, undefined), true);
  assert.equal(captureSubmissionAllowedBySourceConfig(generic, { interestType: 'AFFILIATE' }), false);

  assert.throws(
    () => normalizeCaptureSourcePublicationConfig({
      captureMode: 'GENERIC',
      allowedInterests: [{ interestType: 'AFFILIATE' }],
    }),
    hasCode('CAPTURE_SOURCE_GENERIC_WITH_INTERESTS'),
  );
});

test('brand configuration workspace can list every platform-supported interest option', () => {
  const options = listCaptureSourceInterestOptions();
  assert.ok(options.some((entry) => entry.interestType === 'FRANCHISEE' && entry.opportunityType === 'MULTI_UNIT'));
  assert.ok(options.some((entry) => entry.interestType === 'DISTRIBUTOR' && entry.opportunityType === 'MASTER_DISTRIBUTOR'));
  assert.ok(options.some((entry) => entry.interestType === 'LICENSEE'));
});
