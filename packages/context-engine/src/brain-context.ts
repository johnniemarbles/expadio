import {
  resolveBrainMapSlice,
  type BrainMapPayload,
  type BrainSourceKind,
  type BusinessConfigurationObject,
} from '@expadio/business-config';
import type {
  AuthorizedContextBundle,
  AuthorizedContextEngine,
  ContextKind,
} from './index.ts';

export interface BrainContextAssemblyRequest {
  readonly requestId: string;
  readonly tenantId: string;
  readonly requesterSubjectId: string;
  readonly requesterAgentId: string | null;
  readonly purposeKey: string;
  readonly effectiveAt: string;
  readonly requestedAt: string;
  readonly correlationId: string;
  readonly evidenceRefs: readonly string[];
}

export interface AuthorizedBrainContextBundle {
  readonly brainMapKey: string;
  readonly brainMapVersion: number;
  readonly sliceKey: string;
  readonly expectedContentDigests: readonly string[];
  readonly context: AuthorizedContextBundle;
}

export async function assembleAuthorizedBrainContext(
  engine: Pick<AuthorizedContextEngine, 'assemble'>,
  configuration: BusinessConfigurationObject<BrainMapPayload>,
  request: BrainContextAssemblyRequest,
): Promise<AuthorizedBrainContextBundle> {
  const resolved = resolveBrainMapSlice(configuration, {
    tenantId: request.tenantId,
    purposeKey: request.purposeKey,
    effectiveAt: request.effectiveAt,
  });
  const brainMapReference =
    `business-config://BRAIN_MAP/${resolved.brainMapKey}@${resolved.brainMapVersion}`;
  const context = await engine.assemble({
    requestId: request.requestId,
    tenantId: request.tenantId,
    requesterSubjectId: request.requesterSubjectId,
    requesterAgentId: request.requesterAgentId,
    purpose: request.purposeKey,
    references: resolved.sources.map((source) => ({
      kind: contextKind(source.kind),
      referenceId: source.sourceReference,
    })),
    requestedAt: request.requestedAt,
    correlationId: request.correlationId,
    evidenceRefs: [...new Set([...request.evidenceRefs, brainMapReference])],
  });

  return {
    brainMapKey: resolved.brainMapKey,
    brainMapVersion: resolved.brainMapVersion,
    sliceKey: resolved.sliceKey,
    expectedContentDigests: resolved.sources.map((source) => source.contentDigest),
    context,
  };
}

export function brainSourceContextKind(kind: BrainSourceKind): ContextKind {
  return contextKind(kind);
}

function contextKind(kind: BrainSourceKind): ContextKind {
  switch (kind) {
    case 'PLATFORM_INVARIANT':
    case 'JURISDICTION_POLICY':
    case 'TENANT_POLICY':
      return 'POLICY';
    case 'APPROVED_DECISION':
      return 'DECISION';
    case 'ACTIVE_PRIORITY':
      return 'BUSINESS_EVENT';
    case 'VERIFIED_FACT':
      return 'KNOWLEDGE';
    case 'APPROVED_CAPABILITY':
      return 'CAPABILITY';
    case 'UNREVIEWED_PROPOSAL':
      throw new Error('BRAIN_CONTEXT_UNREVIEWED_SOURCE');
  }
}
