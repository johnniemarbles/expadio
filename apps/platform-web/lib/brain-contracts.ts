import type { AdapterResult, DataSource } from '@expadio/ui/contracts';

export type SourceKind = 'safety' | 'jurisdiction-policy' | 'tenant-policy' | 'decision' | 'priority' | 'fact' | 'capability' | 'proposal';
export type ReviewStatus = 'approved' | 'pending' | 'rejected';
export type CorrectionStage = 'captured' | 'routed' | 'reviewing' | 'accepted' | 'published' | 'rejected';
export type PrecedenceLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface BrainOverview {
  source: DataSource;
  indexedSources: number;
  pendingCorrections: number;
  freshnessTargetHours: number;
  lastIndexedAt: string;
  healthSummary: string;
}

export interface BrainSource {
  id: string;
  name: string;
  kind: SourceKind;
  precedence: PrecedenceLevel;
  reviewStatus: ReviewStatus;
  contentDigest: string;  // SHA-256 per CBOS spec
  effectiveDate: string;
  lastIndexed: string;
  classification?: string;
}

export interface ContextSlice {
  id: string;
  purpose: string;
  sourceCount: number;
  itemLimit: number;
  tenantScope: string;
  lastResolved: string;
}

export interface CorrectionProposal {
  id: string;
  title: string;
  category: SourceKind;
  stage: CorrectionStage;
  proposedBy: string;
  evidenceRefs: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PublicationEvent {
  id: string;
  sourceId: string;
  sourceName: string;
  action: 'published' | 'republished' | 'indexed' | 'reindexed' | 'retracted';
  performedBy: string;
  timestamp: string;
  version: string;
}

export interface ProvenanceEntry {
  id: string;
  sourceId: string;
  action: string;
  actor: string;
  timestamp: string;
  detail: string;
  auditRef?: string;
}

export interface BrainWorkspaceAdapter {
  loadOverview(orgId: string): Promise<AdapterResult<BrainOverview>>;
  loadSources(orgId: string): Promise<AdapterResult<BrainSource[]>>;
  loadSlices(orgId: string): Promise<AdapterResult<ContextSlice[]>>;
  loadCorrections(orgId: string): Promise<AdapterResult<CorrectionProposal[]>>;
  loadReviewQueue(orgId: string): Promise<AdapterResult<CorrectionProposal[]>>;
  loadPublicationHistory(orgId: string): Promise<AdapterResult<PublicationEvent[]>>;
  loadProvenance(orgId: string, sourceId?: string): Promise<AdapterResult<ProvenanceEntry[]>>;
}
