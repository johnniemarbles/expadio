export type HealthTone = "positive" | "attention" | "neutral";
export type CapabilityState = "Published" | "Review" | "Draft";

export interface PlatformMetric {
  label: string;
  value: string;
  detail: string;
  tone: HealthTone;
}

export interface CapabilitySummary {
  id: string;
  name: string;
  kind: "Skill" | "Worker";
  version: string;
  state: CapabilityState;
  scope: string;
  updated: string;
}

export interface ReviewItem {
  id: string;
  title: string;
  category: string;
  requestedBy: string;
  age: string;
  risk: "Low" | "Medium" | "High";
}

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  target: string;
  time: string;
}

export interface PlatformOverview {
  organization: {
    id: string;
    name: string;
    environment: string;
  };
  source: {
    kind: "fixture" | "live";
    label: string;
    capturedAt: string;
  };
  metrics: PlatformMetric[];
  capabilities: CapabilitySummary[];
  reviews: ReviewItem[];
  activity: ActivityItem[];
}

export interface PlatformWorkspaceAdapter {
  loadOverview(organizationId: string): Promise<PlatformOverview>;
}
