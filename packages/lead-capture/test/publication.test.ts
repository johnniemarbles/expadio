import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PublicationError,
  buildPublication,
  resolveHostedFormUrl,
  isPublicationLive,
} from '../src/publication.ts';
import type { BuildPublicationOptions, HostedFormConfig } from '../src/publication.ts';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const BASE_OPTS: BuildPublicationOptions = {
  publicationId: 'pub_001',
  tenantId: 'ten_001',
  organizationId: 'org_001',
  captureConfigId: 'cfg_001',
  interestType: 'FRANCHISEE',
  opportunityType: 'SINGLE_UNIT',
  schemaKey: 'opportunity:franchise:single-unit:v1',
  qualificationProfileKey: 'qualification:franchise:unit:v1',
  workflowBlueprintKey: 'workflow:franchise:unit:v1',
  evidenceProfileKey: 'evidence:franchise:unit:v1',
  defaultRoutingProfileKey: 'routing:franchise:territory:v1',
  publicationMode: 'HOSTED_FORM',
  hostedFormConfig: {
    publicationSlug: '/opportunity',
    brandDomain: 'apply.acmecorp.com',
    postSubmitRedirectUrl: null,
    enablePreFill: true,
  },
  captureSourceId: 'src_001',
  captureSourceLabel: 'Website /opportunity',
  createdAt: '2025-01-15T00:00:00Z',
};

function opts(overrides: Partial<BuildPublicationOptions> = {}): BuildPublicationOptions {
  return { ...BASE_OPTS, ...overrides };
}

function hostedForm(overrides: Partial<HostedFormConfig> = {}): HostedFormConfig {
  return { ...BASE_OPTS.hostedFormConfig as HostedFormConfig, ...overrides };
}

// ── Happy path ────────────────────────────────────────────────────────────────

test('buildPublication: returns valid HOSTED_FORM publication', () => {
  const pub = buildPublication(BASE_OPTS);
  assert.equal(pub.publicationId, 'pub_001');
  assert.equal(pub.publicationMode, 'HOSTED_FORM');
  assert.equal(pub.status, 'DRAFT');
  assert.equal(pub.activatedAt, null);
  assert.equal(pub.archivedAt, null);
});

test('buildPublication: embeds capture source with correct publicationId', () => {
  const pub = buildPublication(BASE_OPTS);
  assert.equal(pub.captureSource.captureSourceId, 'src_001');
  assert.equal(pub.captureSource.publicationId, 'pub_001');
  assert.equal(pub.captureSource.tenantId, 'ten_001');
  assert.equal(pub.captureSource.organizationId, 'org_001');
  assert.equal(pub.captureSource.label, 'Website /opportunity');
});

test('buildPublication: preserves all behavioral keys from options', () => {
  const pub = buildPublication(BASE_OPTS);
  assert.equal(pub.schemaKey, 'opportunity:franchise:single-unit:v1');
  assert.equal(pub.qualificationProfileKey, 'qualification:franchise:unit:v1');
  assert.equal(pub.workflowBlueprintKey, 'workflow:franchise:unit:v1');
  assert.equal(pub.evidenceProfileKey, 'evidence:franchise:unit:v1');
  assert.equal(pub.defaultRoutingProfileKey, 'routing:franchise:territory:v1');
});

test('buildPublication: works for non-HOSTED_FORM mode with null hostedFormConfig', () => {
  const pub = buildPublication(opts({
    publicationMode: 'REST_API',
    hostedFormConfig: null,
  }));
  assert.equal(pub.publicationMode, 'REST_API');
  assert.equal(pub.hostedFormConfig, null);
});

test('buildPublication: works for SIGNED_WEBHOOK mode', () => {
  const pub = buildPublication(opts({
    publicationMode: 'SIGNED_WEBHOOK',
    hostedFormConfig: null,
  }));
  assert.equal(pub.publicationMode, 'SIGNED_WEBHOOK');
  assert.equal(pub.hostedFormConfig, null);
});

test('buildPublication: hostedFormConfig stored correctly on the publication', () => {
  const pub = buildPublication(BASE_OPTS);
  assert.equal(pub.hostedFormConfig!.publicationSlug, '/opportunity');
  assert.equal(pub.hostedFormConfig!.brandDomain, 'apply.acmecorp.com');
  assert.equal(pub.hostedFormConfig!.postSubmitRedirectUrl, null);
  assert.equal(pub.hostedFormConfig!.enablePreFill, true);
});

test('buildPublication: accepts multi-segment neutral slug', () => {
  const pub = buildPublication(opts({
    hostedFormConfig: hostedForm({ publicationSlug: '/join/now' }),
  }));
  assert.equal(pub.hostedFormConfig!.publicationSlug, '/join/now');
});

test('buildPublication: works with null opportunityType (AFFILIATE, AGENT, etc.)', () => {
  const pub = buildPublication(opts({
    interestType: 'AFFILIATE',
    opportunityType: null,
    schemaKey: 'opportunity:affiliate:standard:v1',
    qualificationProfileKey: 'qualification:affiliate:standard:v1',
    workflowBlueprintKey: 'workflow:affiliate:standard:v1',
    evidenceProfileKey: 'evidence:affiliate:standard:v1',
    defaultRoutingProfileKey: 'routing:affiliate:standard:v1',
  }));
  assert.equal(pub.interestType, 'AFFILIATE');
  assert.equal(pub.opportunityType, null);
});

// ── Invariant 4: HOSTED_FORM requires hostedFormConfig ────────────────────────

test('buildPublication: HOSTED_FORM with null hostedFormConfig throws MISSING_HOSTED_FORM_CONFIG', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: null })),
    (e: unknown) => e instanceof PublicationError && e.code === 'MISSING_HOSTED_FORM_CONFIG',
  );
});

test('buildPublication: non-HOSTED_FORM with hostedFormConfig throws UNEXPECTED_HOSTED_FORM_CONFIG', () => {
  assert.throws(
    () => buildPublication(opts({ publicationMode: 'REST_API' })),
    (e: unknown) => e instanceof PublicationError && e.code === 'UNEXPECTED_HOSTED_FORM_CONFIG',
  );
});

// ── Invariant 4: slug must be interest-type-neutral ───────────────────────────

test('slug /franchise is rejected with INTEREST_TYPE_SLUG', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: hostedForm({ publicationSlug: '/franchise' }) })),
    (e: unknown) => e instanceof PublicationError && e.code === 'INTEREST_TYPE_SLUG',
  );
});

test('slug /franchisee is rejected with INTEREST_TYPE_SLUG', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: hostedForm({ publicationSlug: '/franchisee' }) })),
    (e: unknown) => e instanceof PublicationError && e.code === 'INTEREST_TYPE_SLUG',
  );
});

test('slug /distributor is rejected with INTEREST_TYPE_SLUG', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: hostedForm({ publicationSlug: '/distributor' }) })),
    (e: unknown) => e instanceof PublicationError && e.code === 'INTEREST_TYPE_SLUG',
  );
});

test('slug /affiliate is rejected with INTEREST_TYPE_SLUG', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: hostedForm({ publicationSlug: '/affiliate' }) })),
    (e: unknown) => e instanceof PublicationError && e.code === 'INTEREST_TYPE_SLUG',
  );
});

test('slug /licensee is rejected with INTEREST_TYPE_SLUG', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: hostedForm({ publicationSlug: '/licensee' }) })),
    (e: unknown) => e instanceof PublicationError && e.code === 'INTEREST_TYPE_SLUG',
  );
});

test('slug /agent is rejected with INTEREST_TYPE_SLUG', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: hostedForm({ publicationSlug: '/agent' }) })),
    (e: unknown) => e instanceof PublicationError && e.code === 'INTEREST_TYPE_SLUG',
  );
});

test('slug with no leading slash is rejected with INVALID_SLUG', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: hostedForm({ publicationSlug: 'opportunity' }) })),
    (e: unknown) => e instanceof PublicationError && e.code === 'INVALID_SLUG',
  );
});

test('slug with uppercase is rejected with INVALID_SLUG', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: hostedForm({ publicationSlug: '/Opportunity' }) })),
    (e: unknown) => e instanceof PublicationError && e.code === 'INVALID_SLUG',
  );
});

test('slug with trailing slash is rejected with INVALID_SLUG', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: hostedForm({ publicationSlug: '/opportunity/' }) })),
    (e: unknown) => e instanceof PublicationError && e.code === 'INVALID_SLUG',
  );
});

// ── Brand domain validation ───────────────────────────────────────────────────

test('brandDomain with https:// prefix throws INVALID_BRAND_DOMAIN', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: hostedForm({ brandDomain: 'https://apply.acmecorp.com' }) })),
    (e: unknown) => e instanceof PublicationError && e.code === 'INVALID_BRAND_DOMAIN',
  );
});

test('brandDomain with http:// prefix throws INVALID_BRAND_DOMAIN', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: hostedForm({ brandDomain: 'http://apply.acmecorp.com' }) })),
    (e: unknown) => e instanceof PublicationError && e.code === 'INVALID_BRAND_DOMAIN',
  );
});

test('blank brandDomain throws INVALID_BRAND_DOMAIN', () => {
  assert.throws(
    () => buildPublication(opts({ hostedFormConfig: hostedForm({ brandDomain: '   ' }) })),
    (e: unknown) => e instanceof PublicationError && e.code === 'INVALID_BRAND_DOMAIN',
  );
});

// ── Required field guards ─────────────────────────────────────────────────────

test('blank publicationId throws MISSING_FIELD', () => {
  assert.throws(
    () => buildPublication(opts({ publicationId: '' })),
    (e: unknown) => e instanceof PublicationError && e.code === 'MISSING_FIELD',
  );
});

test('blank captureSourceId throws MISSING_FIELD', () => {
  assert.throws(
    () => buildPublication(opts({ captureSourceId: '' })),
    (e: unknown) => e instanceof PublicationError && e.code === 'MISSING_FIELD',
  );
});

test('blank captureSourceLabel throws MISSING_FIELD', () => {
  assert.throws(
    () => buildPublication(opts({ captureSourceLabel: '' })),
    (e: unknown) => e instanceof PublicationError && e.code === 'MISSING_FIELD',
  );
});

// ── resolveHostedFormUrl ──────────────────────────────────────────────────────

test('resolveHostedFormUrl: returns correct HTTPS URL', () => {
  const pub = buildPublication(BASE_OPTS);
  assert.equal(resolveHostedFormUrl(pub), 'https://apply.acmecorp.com/opportunity');
});

test('resolveHostedFormUrl: works with multi-segment slug', () => {
  const pub = buildPublication(opts({
    hostedFormConfig: hostedForm({ publicationSlug: '/join/now' }),
  }));
  assert.equal(resolveHostedFormUrl(pub), 'https://apply.acmecorp.com/join/now');
});

test('resolveHostedFormUrl: throws NOT_HOSTED_FORM for non-hosted-form publication', () => {
  const pub = buildPublication(opts({
    publicationMode: 'REST_API',
    hostedFormConfig: null,
  }));
  assert.throws(
    () => resolveHostedFormUrl(pub),
    (e: unknown) => e instanceof PublicationError && e.code === 'NOT_HOSTED_FORM',
  );
});

// ── isPublicationLive ─────────────────────────────────────────────────────────

test('isPublicationLive: DRAFT publication is not live', () => {
  const pub = buildPublication(BASE_OPTS);
  assert.equal(pub.status, 'DRAFT');
  assert.equal(isPublicationLive(pub), false);
});

test('isPublicationLive: returns true only for ACTIVE status', () => {
  const pub = buildPublication(BASE_OPTS);
  const active = { ...pub, status: 'ACTIVE' as const };
  assert.equal(isPublicationLive(active), true);
  const paused = { ...pub, status: 'PAUSED' as const };
  assert.equal(isPublicationLive(paused), false);
  const archived = { ...pub, status: 'ARCHIVED' as const };
  assert.equal(isPublicationLive(archived), false);
});
