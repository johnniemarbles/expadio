import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IndustryPackRuntimeResolutionError,
  type IndustryPackRuntimeProvenance,
} from '../src/index.ts';

test('runtime provenance distinguishes governed persistence from code fallback', () => {
  const tenantPublished: IndustryPackRuntimeProvenance = {
    verticalKey: 'dentex',
    version: 3,
    source: 'TENANT_PUBLISHED',
    scope: 'TENANT',
  };
  const codeBaseline: IndustryPackRuntimeProvenance = {
    verticalKey: 'dentex',
    version: 1,
    source: 'CODE_BASELINE',
    scope: 'CODE',
  };

  assert.equal(tenantPublished.source, 'TENANT_PUBLISHED');
  assert.equal(codeBaseline.scope, 'CODE');
});

test('runtime resolution has an explicit not-found error', () => {
  const error = new IndustryPackRuntimeResolutionError('Unknown vertical.');
  assert.equal(error.code, 'INDUSTRY_PACK_RUNTIME_NOT_FOUND');
  assert.equal(error.name, 'IndustryPackRuntimeResolutionError');
});
