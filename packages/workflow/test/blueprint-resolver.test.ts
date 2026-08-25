import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RepositoryWorkflowBlueprintResolver,
  WorkflowBlueprintResolutionError,
  type WorkflowBlueprintDefinition,
  type WorkflowBlueprintRepository,
  type WorkflowBlueprintScope,
} from '../src/index.ts';

const platform: WorkflowBlueprintDefinition = {
  blueprintKey: 'partner-platform',
  version: 3,
  label: 'Platform partner onboarding',
  workTypeKey: 'partner-onboarding',
  source: 'PLATFORM',
  state: 'ACTIVE',
  allowsStageAddition: false,
  allowsStageReorder: false,
  allowsStageDeactivation: false,
  minimumRequiredStageKeys: [],
  stages: [],
};

const tenant: WorkflowBlueprintDefinition = {
  ...platform,
  blueprintKey: 'partner-tenant',
  version: 4,
  label: 'Tenant partner onboarding',
  tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  source: 'TENANT_CUSTOMIZED',
};

class MemoryRepository implements WorkflowBlueprintRepository {
  readonly definitions: WorkflowBlueprintDefinition[];
  readonly calls: string[] = [];

  constructor(definitions: readonly WorkflowBlueprintDefinition[]) {
    this.definitions = [...definitions];
  }

  async create(definition: WorkflowBlueprintDefinition): Promise<WorkflowBlueprintDefinition> {
    this.definitions.push(definition);
    return definition;
  }

  async findByIdentity(input: {
    readonly scope: WorkflowBlueprintScope;
    readonly identity: { readonly blueprintKey: string; readonly version: number };
  }): Promise<WorkflowBlueprintDefinition | null> {
    this.calls.push(`find:${input.scope.type}:${input.identity.blueprintKey}@${input.identity.version}`);
    return this.definitions.find((definition) =>
      inScope(definition, input.scope)
      && definition.blueprintKey === input.identity.blueprintKey
      && definition.version === input.identity.version
    ) ?? null;
  }

  async listVersions(input: {
    readonly scope: WorkflowBlueprintScope;
    readonly blueprintKey: string;
  }): Promise<readonly WorkflowBlueprintDefinition[]> {
    return this.definitions.filter((definition) =>
      inScope(definition, input.scope) && definition.blueprintKey === input.blueprintKey
    );
  }

  async listActiveForWorkType(input: {
    readonly scope: WorkflowBlueprintScope;
    readonly workTypeKey: string;
  }): Promise<readonly WorkflowBlueprintDefinition[]> {
    this.calls.push(`active:${input.scope.type}:${input.workTypeKey}`);
    return this.definitions.filter((definition) =>
      inScope(definition, input.scope)
      && definition.workTypeKey === input.workTypeKey
      && definition.state === 'ACTIVE'
    );
  }
}

function inScope(definition: WorkflowBlueprintDefinition, scope: WorkflowBlueprintScope): boolean {
  return scope.type === 'PLATFORM'
    ? definition.source === 'PLATFORM'
    : definition.source === 'TENANT_CUSTOMIZED' && definition.tenantId === scope.tenantId;
}

test('explicit tenant pin resolves exact version before ACTIVE precedence', async () => {
  const supersededTenant = { ...tenant, version: 2, state: 'SUPERSEDED' as const };
  const repository = new MemoryRepository([platform, tenant, supersededTenant]);

  const result = await new RepositoryWorkflowBlueprintResolver(repository).resolve({
    tenantId: tenant.tenantId!,
    workTypeKey: tenant.workTypeKey,
    pinned: { blueprintKey: tenant.blueprintKey, version: 2, scope: 'TENANT' },
  });

  assert.equal(result.reason, 'EXPLICIT_PIN');
  assert.equal(result.blueprint.version, 2);
  assert.deepEqual(result.precedenceTrace, ['explicit-pin:tenant']);
  assert.deepEqual(repository.calls, ['find:TENANT:partner-tenant@2']);
});

test('explicit platform pin never crosses into tenant scope', async () => {
  const sameIdentityTenant = {
    ...tenant,
    blueprintKey: platform.blueprintKey,
    version: platform.version,
  };
  const repository = new MemoryRepository([platform, sameIdentityTenant]);

  const result = await new RepositoryWorkflowBlueprintResolver(repository).resolve({
    tenantId: tenant.tenantId!,
    workTypeKey: platform.workTypeKey,
    pinned: { blueprintKey: platform.blueprintKey, version: platform.version, scope: 'PLATFORM' },
  });

  assert.equal(result.blueprint.source, 'PLATFORM');
  assert.deepEqual(repository.calls, ['find:PLATFORM:partner-platform@3']);
});

test('tenant ACTIVE workflow overrides platform ACTIVE default', async () => {
  const repository = new MemoryRepository([platform, tenant]);

  const result = await new RepositoryWorkflowBlueprintResolver(repository).resolve({
    tenantId: tenant.tenantId!,
    workTypeKey: tenant.workTypeKey,
  });

  assert.equal(result.reason, 'TENANT_ACTIVE_OVERRIDE');
  assert.equal(result.blueprint.blueprintKey, tenant.blueprintKey);
  assert.deepEqual(repository.calls, ['active:TENANT:partner-onboarding']);
});

test('platform ACTIVE workflow is used when tenant has no ACTIVE override', async () => {
  const repository = new MemoryRepository([platform]);

  const result = await new RepositoryWorkflowBlueprintResolver(repository).resolve({
    tenantId: tenant.tenantId!,
    workTypeKey: platform.workTypeKey,
  });

  assert.equal(result.reason, 'PLATFORM_ACTIVE_DEFAULT');
  assert.equal(result.blueprint.blueprintKey, platform.blueprintKey);
  assert.deepEqual(repository.calls, [
    'active:TENANT:partner-onboarding',
    'active:PLATFORM:partner-onboarding',
  ]);
});

test('missing pin and missing ACTIVE workflow fail explicitly', async () => {
  const repository = new MemoryRepository([]);
  const resolver = new RepositoryWorkflowBlueprintResolver(repository);

  await assert.rejects(
    resolver.resolve({
      tenantId: tenant.tenantId!,
      workTypeKey: tenant.workTypeKey,
      pinned: { blueprintKey: 'missing', version: 1, scope: 'TENANT' },
    }),
    (error: unknown) => error instanceof WorkflowBlueprintResolutionError
      && error.code === 'WORKFLOW_BLUEPRINT_PIN_NOT_FOUND',
  );

  await assert.rejects(
    resolver.resolve({ tenantId: tenant.tenantId!, workTypeKey: tenant.workTypeKey }),
    (error: unknown) => error instanceof WorkflowBlueprintResolutionError
      && error.code === 'WORKFLOW_BLUEPRINT_ACTIVE_NOT_FOUND',
  );
});

test('ambiguous repository candidates are rejected defensively', async () => {
  const repository = new MemoryRepository([
    tenant,
    { ...tenant, blueprintKey: 'tenant-second-active', version: 1 },
  ]);

  await assert.rejects(
    new RepositoryWorkflowBlueprintResolver(repository).resolve({
      tenantId: tenant.tenantId!,
      workTypeKey: tenant.workTypeKey,
    }),
    (error: unknown) => error instanceof WorkflowBlueprintResolutionError
      && error.code === 'WORKFLOW_BLUEPRINT_ACTIVE_AMBIGUOUS',
  );
});
