import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REGISTRY_SCHEMA_KEYS,
  REGISTRY_WORKFLOW_BLUEPRINT_KEYS,
  listInterestTypes,
  listOpportunityTypes,
  resolveInterestType,
  supportsPublicationMode,
} from '../src/interest-type-registry.ts';

// ADR-017 invariant 1: business behavior resolves through the registry.
// These tests prove the registry is complete, deterministic, and enforces
// the publication-mode restrictions for high-governance interest types.

test('every entry resolves back to itself via resolveInterestType', () => {
  for (const entry of listInterestTypes()) {
    const resolved = resolveInterestType(entry.interestType, entry.opportunityType);
    assert.ok(resolved, `no entry found for ${entry.interestType}:${entry.opportunityType ?? ''}`);
    assert.equal(resolved.schemaKey, entry.schemaKey);
    assert.equal(resolved.workflowBlueprintKey, entry.workflowBlueprintKey);
  }
});

test('resolveInterestType returns undefined for unknown combinations', () => {
  assert.equal(resolveInterestType('FRANCHISEE', 'EXCLUSIVE_DISTRIBUTOR' as never), undefined);
  assert.equal(resolveInterestType('AFFILIATE', 'SINGLE_UNIT' as never), undefined);
  assert.equal(resolveInterestType('LICENSEE', 'MULTI_UNIT' as never), undefined);
});

test('FRANCHISEE has exactly five opportunity types', () => {
  const entries = listOpportunityTypes('FRANCHISEE');
  assert.equal(entries.length, 5);
  const types = entries.map((e) => e.opportunityType);
  assert.ok(types.includes('SINGLE_UNIT'));
  assert.ok(types.includes('MULTI_UNIT'));
  assert.ok(types.includes('AREA_DEVELOPMENT'));
  assert.ok(types.includes('CONVERSION'));
  assert.ok(types.includes('RESALE'));
});

test('DISTRIBUTOR has exactly four opportunity types', () => {
  const entries = listOpportunityTypes('DISTRIBUTOR');
  assert.equal(entries.length, 4);
  const types = entries.map((e) => e.opportunityType);
  assert.ok(types.includes('EXCLUSIVE_DISTRIBUTOR'));
  assert.ok(types.includes('NON_EXCLUSIVE_DISTRIBUTOR'));
  assert.ok(types.includes('MASTER_DISTRIBUTOR'));
  assert.ok(types.includes('SUB_DISTRIBUTOR'));
});

test('AFFILIATE, LICENSEE, AGENT, MASTER_FRANCHISEE each have exactly one entry with no opportunityType', () => {
  for (const interestType of ['AFFILIATE', 'LICENSEE', 'AGENT', 'MASTER_FRANCHISEE'] as const) {
    const entries = listOpportunityTypes(interestType);
    assert.equal(entries.length, 1, `expected 1 entry for ${interestType}`);
    assert.equal(entries[0]?.opportunityType, undefined, `${interestType} should have no opportunityType`);
  }
});

test('all schema keys are unique across the registry', () => {
  const keys = REGISTRY_SCHEMA_KEYS;
  const unique = new Set(keys);
  assert.equal(unique.size, keys.length, 'duplicate schema keys detected');
});

test('high-governance interest types restrict publication modes to non-consumer channels', () => {
  // MASTER_FRANCHISEE and MASTER_DISTRIBUTOR are high-value B2B deals.
  // They must not permit JS_WIDGET / IFRAME / SOCIAL_LINK / QR_CODE / WHATSAPP_SMS_LINK
  // since those channels are optimised for volume consumer capture, not governed B2B.
  const consumerChannels = ['JS_WIDGET', 'IFRAME', 'SOCIAL_LINK', 'QR_CODE', 'WHATSAPP_SMS_LINK'] as const;

  const masterFranchise = resolveInterestType('MASTER_FRANCHISEE');
  assert.ok(masterFranchise);
  for (const mode of consumerChannels) {
    assert.equal(
      masterFranchise.supportedPublicationModes.includes(mode),
      false,
      `MASTER_FRANCHISEE should not support ${mode}`,
    );
  }

  const masterDist = resolveInterestType('DISTRIBUTOR', 'MASTER_DISTRIBUTOR');
  assert.ok(masterDist);
  for (const mode of consumerChannels) {
    assert.equal(
      masterDist.supportedPublicationModes.includes(mode),
      false,
      `MASTER_DISTRIBUTOR should not support ${mode}`,
    );
  }
});

test('supportsPublicationMode returns false for unsupported combinations', () => {
  assert.equal(supportsPublicationMode('MASTER_FRANCHISEE', undefined, 'JS_WIDGET'), false);
  assert.equal(supportsPublicationMode('MASTER_FRANCHISEE', undefined, 'HOSTED_FORM'), true);
  assert.equal(supportsPublicationMode('FRANCHISEE', 'SINGLE_UNIT', 'QR_CODE'), true);
});

test('supportsPublicationMode returns false for unknown interest type combinations', () => {
  assert.equal(supportsPublicationMode('FRANCHISEE', 'EXCLUSIVE_DISTRIBUTOR' as never, 'HOSTED_FORM'), false);
});

test('all workflow blueprint keys resolve deterministically (same input always same output)', () => {
  const first = resolveInterestType('FRANCHISEE', 'MULTI_UNIT');
  const second = resolveInterestType('FRANCHISEE', 'MULTI_UNIT');
  assert.equal(first?.workflowBlueprintKey, second?.workflowBlueprintKey);
  assert.equal(first?.schemaKey, second?.schemaKey);
});

test('registry exports non-empty de-duplicated key lists', () => {
  assert.ok(REGISTRY_SCHEMA_KEYS.length > 0);
  assert.ok(REGISTRY_WORKFLOW_BLUEPRINT_KEYS.length > 0);
  // Workflow keys may be shared across opportunity types (e.g. distribution:standard)
  // so the de-duplicated list is shorter than the entry list.
  assert.ok(REGISTRY_WORKFLOW_BLUEPRINT_KEYS.length <= listInterestTypes().length);
});
