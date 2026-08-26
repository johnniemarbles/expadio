export type AgentCapabilityManifestScope =
  | { readonly kind: 'PLATFORM' }
  | { readonly kind: 'VERTICAL'; readonly verticalKey: string }
  | { readonly kind: 'TENANT'; readonly tenantId: string };

export interface AgentCapabilitySchemaReference {
  readonly schemaReference: string;
  readonly schemaDigest: string;
}

export interface AgentCapabilityReference {
  readonly key: string;
  readonly version: number;
}

export interface AgentCapabilityManifest {
  readonly kind: 'SKILL' | 'WORKER';
  readonly key: string;
  readonly version: number;
  readonly state: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  readonly scope: AgentCapabilityManifestScope;
  readonly ownerSubjectId: string;
  readonly instructionReference: string;
  readonly instructionDigest: string;
  readonly inputSchema: AgentCapabilitySchemaReference;
  readonly outputSchema: AgentCapabilitySchemaReference;
  readonly requiredPermissionKeys: readonly string[];
  readonly allowedToolKeys: readonly string[];
  readonly negativeConstraintKeys: readonly string[];
  readonly budgetPolicyReference: string;
  readonly maxSteps: number;
  readonly maxCostMinorUnits: number;
  readonly timeoutSeconds: number;
  readonly stopConditionKeys: readonly string[];
  readonly escalationPolicyReference: string;
  readonly skillReferences: readonly AgentCapabilityReference[];
  readonly verifiedAt: string | null;
  readonly effectiveFrom: string;
  readonly evidenceRefs: readonly string[];
}

export class AgentCapabilityManifestError extends Error {
  readonly code:
    | 'AGENT_CAPABILITY_MANIFEST_INVALID'
    | 'AGENT_CAPABILITY_MANIFEST_UNEXPECTED_FIELD'
    | 'AGENT_CAPABILITY_MANIFEST_DUPLICATE_ENTRY'
    | 'AGENT_CAPABILITY_MANIFEST_VERIFICATION_REQUIRED'
    | 'AGENT_CAPABILITY_SKILL_REFERENCE_INVALID';

  constructor(code: AgentCapabilityManifestError['code'], message: string) {
    super(message);
    this.name = 'AgentCapabilityManifestError';
    this.code = code;
  }
}

export function validateAgentCapabilityManifest(
  manifest: AgentCapabilityManifest,
): void {
  const allowed = new Set([
    'kind', 'key', 'version', 'state', 'scope', 'ownerSubjectId',
    'instructionReference', 'instructionDigest', 'inputSchema', 'outputSchema',
    'requiredPermissionKeys', 'allowedToolKeys', 'negativeConstraintKeys',
    'budgetPolicyReference', 'maxSteps', 'maxCostMinorUnits', 'timeoutSeconds',
    'stopConditionKeys', 'escalationPolicyReference', 'skillReferences',
    'verifiedAt', 'effectiveFrom', 'evidenceRefs',
  ]);
  if (Object.keys(manifest).some((key) => !allowed.has(key))) {
    throw new AgentCapabilityManifestError(
      'AGENT_CAPABILITY_MANIFEST_UNEXPECTED_FIELD',
      'Capability manifests are reference-only and reject undeclared fields.',
    );
  }
  if (
    !stable(manifest.key)
    || !Number.isInteger(manifest.version)
    || manifest.version < 1
    || !validScope(manifest.scope)
    || !stable(manifest.ownerSubjectId)
    || !stable(manifest.instructionReference)
    || !digest(manifest.instructionDigest)
    || !schema(manifest.inputSchema)
    || !schema(manifest.outputSchema)
    || !stable(manifest.budgetPolicyReference)
    || !Number.isInteger(manifest.maxSteps)
    || manifest.maxSteps < 1
    || !Number.isInteger(manifest.maxCostMinorUnits)
    || manifest.maxCostMinorUnits < 0
    || !Number.isInteger(manifest.timeoutSeconds)
    || manifest.timeoutSeconds < 1
    || !stable(manifest.escalationPolicyReference)
    || !instant(manifest.effectiveFrom)
    || (manifest.verifiedAt !== null && !instant(manifest.verifiedAt))
    || !nonEmpty(manifest.requiredPermissionKeys)
    || !nonEmpty(manifest.negativeConstraintKeys)
    || !nonEmpty(manifest.stopConditionKeys)
    || !nonEmpty(manifest.evidenceRefs)
  ) {
    throw new AgentCapabilityManifestError(
      'AGENT_CAPABILITY_MANIFEST_INVALID',
      'Capability manifests require governed identity, schemas, constraints, permissions, budget, time, escalation, and evidence.',
    );
  }
  for (const entries of [
    manifest.requiredPermissionKeys,
    manifest.allowedToolKeys,
    manifest.negativeConstraintKeys,
    manifest.stopConditionKeys,
    manifest.evidenceRefs,
  ]) {
    if (entries.some((value) => !stable(value)) || new Set(entries).size !== entries.length) {
      throw new AgentCapabilityManifestError(
        'AGENT_CAPABILITY_MANIFEST_DUPLICATE_ENTRY',
        'Manifest lists require stable unique values.',
      );
    }
  }
  if (
    manifest.state === 'PUBLISHED'
    && (manifest.verifiedAt === null || !instant(manifest.verifiedAt))
  ) {
    throw new AgentCapabilityManifestError(
      'AGENT_CAPABILITY_MANIFEST_VERIFICATION_REQUIRED',
      'Published capability manifests require a verification time.',
    );
  }
  if (manifest.kind === 'SKILL' && manifest.skillReferences.length !== 0) {
    throw new AgentCapabilityManifestError(
      'AGENT_CAPABILITY_SKILL_REFERENCE_INVALID',
      'Skill manifests cannot recursively include skills.',
    );
  }
  const references = manifest.skillReferences.map((reference) => `${reference.key}@${reference.version}`);
  if (
    manifest.kind === 'WORKER'
    && (
      manifest.skillReferences.length === 0
      || manifest.skillReferences.some((reference) =>
        !stable(reference.key) || !Number.isInteger(reference.version) || reference.version < 1)
      || new Set(references).size !== references.length
    )
  ) {
    throw new AgentCapabilityManifestError(
      'AGENT_CAPABILITY_SKILL_REFERENCE_INVALID',
      'Worker manifests require unique versioned skill references.',
    );
  }
}

function validScope(scope: AgentCapabilityManifestScope): boolean {
  if (scope.kind === 'PLATFORM') return true;
  return scope.kind === 'VERTICAL' ? stable(scope.verticalKey) : stable(scope.tenantId);
}
function schema(value: AgentCapabilitySchemaReference): boolean {
  return stable(value.schemaReference) && digest(value.schemaDigest);
}
function nonEmpty(values: readonly string[]): boolean { return values.length > 0; }
function digest(value: string): boolean { return /^sha256:[a-f0-9]{64}$/u.test(value); }
function stable(value: string): boolean {
  return value.trim() !== '' && value === value.trim() && !/[\r\n\t]/u.test(value);
}
function instant(value: string): boolean {
  return stable(value) && Number.isFinite(Date.parse(value));
}
