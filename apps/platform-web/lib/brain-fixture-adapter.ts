import type { AdapterResult } from '@expadio/ui/contracts';
import {
  BrainWorkspaceAdapter,
  BrainOverview,
  BrainSource,
  ContextSlice,
  CorrectionProposal,
  PublicationEvent,
  ProvenanceEntry
} from './brain-contracts';

const orgIdMatches = (orgId: string) => orgId === 'org_dreamware';

import type { DataSource } from '@expadio/ui/contracts';

export const brainFixtureSource: DataSource = { kind: 'fixture', label: 'Fixture data', capturedAt: new Date().toISOString() };

const brainOverview: BrainOverview = {
  source: brainFixtureSource,
  indexedSources: 42,
  pendingCorrections: 4,
  freshnessTargetHours: 24,
  lastIndexedAt: new Date().toISOString(),
  healthSummary: 'Healthy - 98% sources fresh'
};

const brainSources: BrainSource[] = [
  { id: 's1', name: 'Global Safety Protocol v4', kind: 'safety', precedence: 1, reviewStatus: 'approved', contentDigest: 'sha256:d3b07384', effectiveDate: '2025-01-01', lastIndexed: new Date().toISOString() },
  { id: 's2', name: 'EU Data Privacy Addendum', kind: 'jurisdiction-policy', precedence: 2, reviewStatus: 'approved', contentDigest: 'sha256:a4c01289', effectiveDate: '2025-02-15', lastIndexed: new Date().toISOString() },
  { id: 's3', name: 'Dreamware Security Policy', kind: 'tenant-policy', precedence: 3, reviewStatus: 'approved', contentDigest: 'sha256:f129a031', effectiveDate: '2026-01-10', lastIndexed: new Date().toISOString() },
  { id: 's4', name: 'ADR-42: Move to Next.js 16', kind: 'decision', precedence: 4, reviewStatus: 'approved', contentDigest: 'sha256:8b9a102c', effectiveDate: '2026-03-20', lastIndexed: new Date().toISOString() },
  { id: 's5', name: 'Q3 Product Priorities', kind: 'priority', precedence: 5, reviewStatus: 'approved', contentDigest: 'sha256:e10b1009', effectiveDate: '2026-07-01', lastIndexed: new Date().toISOString() },
  { id: 's6', name: 'Supported Browser List 2026', kind: 'fact', precedence: 6, reviewStatus: 'approved', contentDigest: 'sha256:0f9c2a11', effectiveDate: '2026-01-01', lastIndexed: new Date().toISOString() },
  { id: 's7', name: 'AI Generation Capability', kind: 'capability', precedence: 7, reviewStatus: 'approved', contentDigest: 'sha256:b1d9a200', effectiveDate: '2026-05-15', lastIndexed: new Date().toISOString() },
  { id: 's8', name: 'Update to Component Library', kind: 'proposal', precedence: 8, reviewStatus: 'pending', contentDigest: 'sha256:a2b8c9d0', effectiveDate: '2026-08-25', lastIndexed: new Date().toISOString() },
];

const contextSlices: ContextSlice[] = [
  { id: 'cs1', purpose: 'UI Development', sourceCount: 15, itemLimit: 50, tenantScope: 'org_dreamware', lastResolved: new Date().toISOString() },
  { id: 'cs2', purpose: 'Backend API Design', sourceCount: 12, itemLimit: 40, tenantScope: 'org_dreamware', lastResolved: new Date().toISOString() },
  { id: 'cs3', purpose: 'Marketing Campaigns', sourceCount: 8, itemLimit: 30, tenantScope: 'org_dreamware', lastResolved: new Date().toISOString() },
];

const corrections: CorrectionProposal[] = [
  { id: 'cp1', title: 'Update button component colors', category: 'proposal', stage: 'reviewing', proposedBy: 'alice@dreamware.com', evidenceRefs: ['doc-123'], createdAt: '2026-08-20T10:00:00Z', updatedAt: '2026-08-21T14:00:00Z' },
  { id: 'cp2', title: 'Refactor auth middleware', category: 'proposal', stage: 'routed', proposedBy: 'bob@dreamware.com', evidenceRefs: [], createdAt: '2026-08-22T09:00:00Z', updatedAt: '2026-08-22T09:30:00Z' },
  { id: 'cp3', title: 'Fix typo in README', category: 'proposal', stage: 'captured', proposedBy: 'charlie@dreamware.com', evidenceRefs: ['doc-456'], createdAt: '2026-08-25T11:00:00Z', updatedAt: '2026-08-25T11:00:00Z' },
  { id: 'cp4', title: 'Add dark mode support', category: 'proposal', stage: 'accepted', proposedBy: 'dana@dreamware.com', evidenceRefs: ['figma-890'], createdAt: '2026-08-15T16:00:00Z', updatedAt: '2026-08-18T10:00:00Z' }
];

const publicationEvents: PublicationEvent[] = [
  { id: 'pe1', sourceId: 's4', sourceName: 'ADR-42: Move to Next.js 16', action: 'published', performedBy: 'system', timestamp: '2026-03-20T10:00:00Z', version: '1.0' },
  { id: 'pe2', sourceId: 's5', sourceName: 'Q3 Product Priorities', action: 'published', performedBy: 'system', timestamp: '2026-07-01T09:00:00Z', version: '1.0' },
  { id: 'pe3', sourceId: 's6', sourceName: 'Supported Browser List 2026', action: 'indexed', performedBy: 'indexer', timestamp: '2026-01-01T12:00:00Z', version: '1.0' },
  { id: 'pe4', sourceId: 's7', sourceName: 'AI Generation Capability', action: 'published', performedBy: 'system', timestamp: '2026-05-15T14:00:00Z', version: '1.0' },
  { id: 'pe5', sourceId: 's1', sourceName: 'Global Safety Protocol v4', action: 'reindexed', performedBy: 'indexer', timestamp: '2026-08-01T10:00:00Z', version: '4.1' }
];

const provenanceEntries: ProvenanceEntry[] = [
  { id: 'pr1', sourceId: 's1', action: 'Create', actor: 'Alice', timestamp: '2025-01-01T08:00:00Z', detail: 'Initial creation' },
  { id: 'pr2', sourceId: 's1', action: 'Review', actor: 'Bob', timestamp: '2025-01-02T09:00:00Z', detail: 'Approved by security team' },
  { id: 'pr3', sourceId: 's2', action: 'Create', actor: 'Charlie', timestamp: '2025-02-15T10:00:00Z', detail: 'Drafted EU addendum' },
  { id: 'pr4', sourceId: 's2', action: 'Approve', actor: 'Dana', timestamp: '2025-02-16T11:00:00Z', detail: 'Legal review passed' },
  { id: 'pr5', sourceId: 's4', action: 'Create', actor: 'Eve', timestamp: '2026-03-20T09:00:00Z', detail: 'Created ADR for Next.js 16' },
  { id: 'pr6', sourceId: 's4', action: 'Publish', actor: 'System', timestamp: '2026-03-20T10:00:00Z', detail: 'Auto-published ADR' }
];

export const brainFixtureAdapter: BrainWorkspaceAdapter = {
  async loadOverview(orgId) {
    if (!orgIdMatches(orgId)) return { denied: true as const, reasonKey: 'ORG_FORBIDDEN', message: 'Not authorized for this organization', correlationId: 'brain-overview' };
    return brainOverview;
  },
  async loadSources(orgId) {
    if (!orgIdMatches(orgId)) return { denied: true as const, reasonKey: 'ORG_FORBIDDEN', message: 'Not authorized for this organization', correlationId: 'brain-sources' };
    return structuredClone(brainSources);
  },
  async loadSlices(orgId) {
    if (!orgIdMatches(orgId)) return { denied: true as const, reasonKey: 'ORG_FORBIDDEN', message: 'Not authorized for this organization', correlationId: 'brain-slices' };
    return structuredClone(contextSlices);
  },
  async loadCorrections(orgId) {
    if (!orgIdMatches(orgId)) return { denied: true as const, reasonKey: 'ORG_FORBIDDEN', message: 'Not authorized for this organization', correlationId: 'brain-corrections' };
    return structuredClone(corrections);
  },
  async loadReviewQueue(orgId) {
    if (!orgIdMatches(orgId)) return { denied: true as const, reasonKey: 'ORG_FORBIDDEN', message: 'Not authorized for this organization', correlationId: 'brain-review-queue' };
    return structuredClone(corrections.filter(c => c.stage === 'reviewing' || c.stage === 'routed'));
  },
  async loadPublicationHistory(orgId) {
    if (!orgIdMatches(orgId)) return { denied: true as const, reasonKey: 'ORG_FORBIDDEN', message: 'Not authorized for this organization', correlationId: 'brain-publication-history' };
    return structuredClone(publicationEvents);
  },
  async loadProvenance(orgId, sourceId) {
    if (!orgIdMatches(orgId)) return { denied: true as const, reasonKey: 'ORG_FORBIDDEN', message: 'Not authorized for this organization', correlationId: 'brain-provenance' };
    let filtered = provenanceEntries;
    if (sourceId !== undefined) {
      filtered = filtered.filter(p => p.sourceId === sourceId);
    }
    return structuredClone(filtered);
  }
};
