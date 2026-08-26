import type { DeniedResult, DataSource, WiringStatus, AdapterResult } from "@expadio/ui/contracts";
export type { DeniedResult, DataSource, WiringStatus, AdapterResult };
export type HealthTone = "positive" | "attention" | "neutral";
export type CapabilityState = "Published" | "Review" | "Draft";
export type OrganizationLevel = "platform" | "country" | "region" | "city";
export interface PlatformMetric { label: string; value: string; detail: string; tone: HealthTone; }
export interface CapabilitySummary { id: string; name: string; kind: "Skill" | "Worker"; version: string; state: CapabilityState; scope: string; updated: string; }
export interface ReviewItem { id: string; title: string; category: string; requestedBy: string; age: string; risk: "Low" | "Medium" | "High"; }
export interface ActivityItem { id: string; actor: string; action: string; target: string; time: string; timeLabel: string; }
export interface PlatformOrganization { id: string; name: string; environment: string; level: OrganizationLevel; parentId: string | null; }
export interface PlatformAccount { id: string; name: string; role: string; initials: string; allowedOrganizationIds: string[]; }
export interface PlatformWorkspaceContext { accounts: PlatformAccount[]; organizations: PlatformOrganization[]; }
export interface PlatformOverview {
  organization: PlatformOrganization;
  source: { kind: "fixture" | "live"; label: string; capturedAt: string; };
  metrics: PlatformMetric[]; capabilities: CapabilitySummary[]; reviews: ReviewItem[]; activity: ActivityItem[];
}
export interface WorkspaceSection { id: string; label: string; short: string; href: string; }
export interface PlatformWorkspaceAdapter {
  loadOverview(organizationId: string): Promise<AdapterResult<PlatformOverview>>;
  loadWorkspaceContext(): Promise<PlatformWorkspaceContext>;
  loadAllowedWorkspaces(): Promise<WorkspaceSection[]>;
  loadCapabilities(orgId: string): Promise<AdapterResult<CapabilitySummary[]>>;
  loadReviews(orgId: string): Promise<AdapterResult<ReviewItem[]>>;
  loadActivity(orgId: string): Promise<AdapterResult<ActivityItem[]>>;
  loadOrganization(orgId: string): Promise<AdapterResult<PlatformOrganization>>;
}
