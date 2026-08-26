import {
  validateAgentCapabilityManifest,
  type AgentCapabilityManifest,
  type AgentCapabilityManifestScope,
} from './agent-capability-manifest.ts';

export interface PublishedAgentCapabilityQuery {
  readonly kind: 'SKILL' | 'WORKER';
  readonly key: string;
  readonly version?: number;
  readonly tenantId: string;
  readonly verticalKeys: readonly string[];
  readonly effectiveAt: string;
}

export interface AgentCapabilityManifestRepository {
  findByKindAndKey(
    kind: 'SKILL' | 'WORKER',
    key: string,
  ): Promise<readonly AgentCapabilityManifest[]>;
}

export interface ResolvedPublishedAgentCapability {
  readonly manifest: AgentCapabilityManifest;
  readonly resolvedSkills: readonly AgentCapabilityManifest[];
}

export type AgentCapabilityResolutionErrorCode =
  | 'AGENT_CAPABILITY_RESOLUTION_QUERY_INVALID'
  | 'AGENT_CAPABILITY_NOT_FOUND'
  | 'AGENT_CAPABILITY_SCOPE_AMBIGUOUS'
  | 'AGENT_CAPABILITY_SKILL_NOT_FOUND';

export class AgentCapabilityResolutionError extends Error {
  readonly code: AgentCapabilityResolutionErrorCode;
  readonly capabilityKey: string;

  constructor(
    code: AgentCapabilityResolutionErrorCode,
    message: string,
    capabilityKey: string,
  ) {
    super(message);
    this.name = 'AgentCapabilityResolutionError';
    this.code = code;
    this.capabilityKey = capabilityKey;
  }
}

export class PublishedAgentCapabilityResolver {
  constructor(
    private readonly repository: AgentCapabilityManifestRepository,
  ) {}

  async resolve(
    query: PublishedAgentCapabilityQuery,
  ): Promise<ResolvedPublishedAgentCapability> {
    validateQuery(query);

    const manifest = await this.resolveManifest(query);
    if (manifest.kind === 'SKILL') {
      return { manifest, resolvedSkills: [] };
    }

    const resolvedSkills: AgentCapabilityManifest[] = [];
    for (const reference of manifest.skillReferences) {
      try {
        const skill = await this.resolveManifest({
          kind: 'SKILL',
          key: reference.key,
          version: reference.version,
          tenantId: query.tenantId,
          verticalKeys: allowedVerticalKeys(manifest.scope, query.verticalKeys),
          effectiveAt: query.effectiveAt,
        }, allowedScopesForWorker(manifest.scope));

        resolvedSkills.push(skill);
      } catch (error) {
        if (
          error instanceof AgentCapabilityResolutionError
          && error.code === 'AGENT_CAPABILITY_NOT_FOUND'
        ) {
          throw new AgentCapabilityResolutionError(
            'AGENT_CAPABILITY_SKILL_NOT_FOUND',
            `Published worker ${manifest.key}@${manifest.version} references an unavailable skill.`,
            reference.key,
          );
        }
        throw error;
      }
    }

    return { manifest, resolvedSkills };
  }

  private async resolveManifest(
    query: PublishedAgentCapabilityQuery,
    workerScopes?: readonly AgentCapabilityManifestScope['kind'][],
  ): Promise<AgentCapabilityManifest> {
    const candidates = await this.repository.findByKindAndKey(
      query.kind,
      query.key,
    );
    const effectiveAt = Date.parse(query.effectiveAt);

    const eligible = candidates.filter((manifest) => {
      validateAgentCapabilityManifest(manifest);
      return manifest.kind === query.kind
        && manifest.key === query.key
        && manifest.state === 'PUBLISHED'
        && (query.version === undefined || manifest.version === query.version)
        && Date.parse(manifest.effectiveFrom) <= effectiveAt
        && manifest.verifiedAt !== null
        && Date.parse(manifest.verifiedAt) <= effectiveAt
        && scopeRank(manifest.scope, query) >= 0
        && (
          workerScopes === undefined
          || workerScopes.includes(manifest.scope.kind)
        );
    });

    if (eligible.length === 0) {
      throw new AgentCapabilityResolutionError(
        'AGENT_CAPABILITY_NOT_FOUND',
        'No effective published capability is available in the requested scope.',
        query.key,
      );
    }

    const bestRank = Math.max(
      ...eligible.map((manifest) => scopeRank(manifest.scope, query)),
    );
    const ranked = eligible.filter(
      (manifest) => scopeRank(manifest.scope, query) === bestRank,
    );
    const bestVersion = query.version ?? Math.max(
      ...ranked.map((manifest) => manifest.version),
    );
    const selected = ranked.filter(
      (manifest) => manifest.version === bestVersion,
    );

    if (selected.length !== 1) {
      throw new AgentCapabilityResolutionError(
        'AGENT_CAPABILITY_SCOPE_AMBIGUOUS',
        'Published capability resolution must produce one scope and version.',
        query.key,
      );
    }

    const resolved = selected[0];
    if (resolved === undefined) {
      throw new AgentCapabilityResolutionError(
        'AGENT_CAPABILITY_NOT_FOUND',
        'No published capability matched the resolved version.',
        query.key,
      );
    }
    return resolved;
  }
}

function validateQuery(query: PublishedAgentCapabilityQuery): void {
  if (
    !stable(query.key)
    || !stable(query.tenantId)
    || (query.version !== undefined
      && (!Number.isInteger(query.version) || query.version < 1))
    || query.verticalKeys.some((key) => !stable(key))
    || new Set(query.verticalKeys).size !== query.verticalKeys.length
    || !stable(query.effectiveAt)
    || !Number.isFinite(Date.parse(query.effectiveAt))
  ) {
    throw new AgentCapabilityResolutionError(
      'AGENT_CAPABILITY_RESOLUTION_QUERY_INVALID',
      'Resolution requires stable identity, scope, optional version, and effective time.',
      query.key,
    );
  }
}

function scopeRank(
  scope: AgentCapabilityManifestScope,
  query: PublishedAgentCapabilityQuery,
): number {
  if (scope.kind === 'TENANT') {
    return scope.tenantId === query.tenantId ? 3 : -1;
  }
  if (scope.kind === 'VERTICAL') {
    const index = query.verticalKeys.indexOf(scope.verticalKey);
    return index === -1 ? -1 : 2 - (index / 1000);
  }
  return 1;
}

function allowedScopesForWorker(
  scope: AgentCapabilityManifestScope,
): readonly AgentCapabilityManifestScope['kind'][] {
  if (scope.kind === 'PLATFORM') return ['PLATFORM'];
  if (scope.kind === 'VERTICAL') return ['VERTICAL', 'PLATFORM'];
  return ['TENANT', 'VERTICAL', 'PLATFORM'];
}

function allowedVerticalKeys(
  scope: AgentCapabilityManifestScope,
  requestVerticalKeys: readonly string[],
): readonly string[] {
  if (scope.kind === 'PLATFORM') return [];
  if (scope.kind === 'VERTICAL') return [scope.verticalKey];
  return requestVerticalKeys;
}

function stable(value: string): boolean {
  return value.trim() !== ''
    && value === value.trim()
    && !/[\r\n\t]/u.test(value);
}
