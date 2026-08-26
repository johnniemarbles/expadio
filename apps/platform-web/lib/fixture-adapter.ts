import type {
  PlatformOverview,
  PlatformWorkspaceAdapter,
  WorkspaceSection,
  CapabilitySummary,
  ReviewItem,
  ActivityItem,
  AdapterResult,
} from "./contracts";

const fixtureOverview: PlatformOverview = {
  organization: {
    id: "org_dreamware",
    name: "DREAMWARE Group",
    environment: "Platform workspace",
  },
  source: {
    kind: "fixture",
    label: "Fixture contract",
    capturedAt: "26 Aug 2026 · 13:35 IST",
  },
  metrics: [
    {
      label: "Published capabilities",
      value: "18",
      detail: "11 skills · 7 workers",
      tone: "positive",
    },
    {
      label: "Active organizations",
      value: "6",
      detail: "All within policy",
      tone: "neutral",
    },
    {
      label: "Governance review",
      value: "4",
      detail: "1 high-priority item",
      tone: "attention",
    },
    {
      label: "Policy health",
      value: "99.7%",
      detail: "Last 30 days",
      tone: "positive",
    },
  ],
  capabilities: [
    {
      id: "cap_knowledge_curator",
      name: "Knowledge Curator",
      kind: "Worker",
      version: "v1.4",
      state: "Published",
      scope: "DREAMWARE Group",
      updated: "8 min ago",
    },
    {
      id: "cap_correction_review",
      name: "Correction Review",
      kind: "Skill",
      version: "v2.1",
      state: "Review",
      scope: "Platform",
      updated: "24 min ago",
    },
    {
      id: "cap_policy_explainer",
      name: "Policy Explainer",
      kind: "Worker",
      version: "v1.2",
      state: "Published",
      scope: "Platform",
      updated: "2 hr ago",
    },
    {
      id: "cap_source_verifier",
      name: "Source Verifier",
      kind: "Skill",
      version: "v3.0",
      state: "Draft",
      scope: "DREAMWARE Group",
      updated: "Yesterday",
    },
  ],
  reviews: [
    {
      id: "review_041",
      title: "Publish Correction Review v2.1",
      category: "Capability",
      requestedBy: "Aisha Rahman",
      age: "24 min",
      risk: "Medium",
    },
    {
      id: "review_042",
      title: "Approve finance knowledge source",
      category: "Company Brain",
      requestedBy: "Marco Silva",
      age: "1 hr",
      risk: "High",
    },
    {
      id: "review_043",
      title: "Expand EMEA worker scope",
      category: "Governance",
      requestedBy: "Nina Chen",
      age: "3 hr",
      risk: "Low",
    },
  ],
  activity: [
    {
      id: "activity_301",
      actor: "Knowledge Curator",
      action: "indexed publication",
      target: "Customer support handbook",
      time: "8 min ago",
    },
    {
      id: "activity_302",
      actor: "Aisha Rahman",
      action: "submitted correction",
      target: "Expense approval policy",
      time: "24 min ago",
    },
    {
      id: "activity_303",
      actor: "Policy Engine",
      action: "denied scope expansion",
      target: "Finance Operations worker",
      time: "41 min ago",
    },
  ],
};

const sections: WorkspaceSection[] = [
  { id: "overview", label: "Overview", short: "OV", href: "/" },
  { id: "organizations", label: "Organizations", short: "OR", href: "/organizations" },
  { id: "capabilities", label: "Capabilities", short: "CA", href: "/capabilities" },
  { id: "brain", label: "Company Brain", short: "CB", href: "/brain" },
  { id: "governance", label: "Governance", short: "GO", href: "/governance" },
  { id: "audit", label: "Audit", short: "AU", href: "/audit" },
];

export const fixtureWorkspaceAdapter: PlatformWorkspaceAdapter = {
  async loadOverview(organizationId) {
    if (organizationId !== fixtureOverview.organization.id) {
      throw new Error("Fixture organization is not available.");
    }
    return structuredClone(fixtureOverview);
  },

  async loadAllowedWorkspaces() {
    return structuredClone(sections);
  },

  async loadCapabilities(orgId) {
    if (orgId !== fixtureOverview.organization.id) {
      return { denied: true, reasonKey: "NOT_FOUND", message: "Organization not found" };
    }
    return structuredClone(fixtureOverview.capabilities);
  },

  async loadReviews(orgId) {
    if (orgId !== fixtureOverview.organization.id) {
      return { denied: true, reasonKey: "NOT_FOUND", message: "Organization not found" };
    }
    return structuredClone(fixtureOverview.reviews);
  },

  async loadActivity(orgId) {
    if (orgId !== fixtureOverview.organization.id) {
      return { denied: true, reasonKey: "NOT_FOUND", message: "Organization not found" };
    }
    return structuredClone(fixtureOverview.activity);
  },

  async loadOrganization(orgId) {
    if (orgId !== fixtureOverview.organization.id) {
      return { denied: true, reasonKey: "NOT_FOUND", message: "Organization not found" };
    }
    return structuredClone(fixtureOverview.organization);
  },
};
