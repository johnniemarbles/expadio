import assert from "node:assert/strict";
import test from "node:test";
import { fixtureWorkspaceAdapter } from "../lib/fixture-adapter.ts";
import { brainFixtureAdapter } from "../lib/brain-fixture-adapter.ts";

test("fixture accounts expose labelled, declared organization scopes", async () => {
  const context = await fixtureWorkspaceAdapter.loadWorkspaceContext();
  const known = new Set(context.organizations.map((organization) => organization.id));
  for (const account of context.accounts) {
    assert.ok(account.name.trim());
    assert.ok(account.role.trim());
    assert.ok(account.initials.trim());
    assert.ok(account.allowedOrganizationIds.length > 0);
    assert.ok(account.allowedOrganizationIds.every((id) => known.has(id)));
  }
});

test("every selectable organization resolves a scoped overview", async () => {
  const context = await fixtureWorkspaceAdapter.loadWorkspaceContext();
  for (const organization of context.organizations) {
    const result = await fixtureWorkspaceAdapter.loadOverview(organization.id);
    assert.equal("denied" in result, false);
    if (!("denied" in result)) assert.equal(result.organization.id, organization.id);
  }
});

test("company brain fixture uses full SHA-256 digests and evidence", async () => {
  const sources = await brainFixtureAdapter.loadSources("org_dreamware");
  assert.equal("denied" in sources, false);
  if (!("denied" in sources)) {
    assert.ok(sources.every((source) => /^sha256:[a-f0-9]{64}$/u.test(source.contentDigest)));
  }
  const corrections = await brainFixtureAdapter.loadCorrections("org_dreamware");
  assert.equal("denied" in corrections, false);
  if (!("denied" in corrections)) {
    assert.ok(corrections.every((correction) => correction.evidenceRefs.length > 0));
  }
});
