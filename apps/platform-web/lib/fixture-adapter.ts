import type { PlatformOverview, PlatformWorkspaceAdapter, WorkspaceSection, CapabilitySummary, ReviewItem, ActivityItem, AdapterResult, PlatformOrganization, PlatformWorkspaceContext } from "./contracts";

export const fixtureSource = { kind: "fixture" as const, label: "Fixture contract · live APIs not connected", capturedAt: "2026-08-26T08:05:00.000Z" };
const organizations: PlatformOrganization[] = [
  { id: "org_dreamware", name: "DREAMWARE Group", environment: "Global platform workspace", level: "platform", parentId: null },
  { id: "org_dreamware_canada", name: "DREAMWARE Canada", environment: "Country workspace", level: "country", parentId: "org_dreamware" },
  { id: "org_dreamware_ontario", name: "DREAMWARE Ontario", environment: "Regional workspace", level: "region", parentId: "org_dreamware_canada" },
  { id: "org_dreamware_toronto", name: "DREAMWARE Toronto", environment: "City workspace", level: "city", parentId: "org_dreamware_ontario" },
];
const workspaceContext: PlatformWorkspaceContext = {
  accounts: [
    { id: "account_platform", name: "Johnnie Marbles", role: "Platform owner · fixture session", initials: "JM", allowedOrganizationIds: organizations.map((item) => item.id) },
    { id: "account_brand", name: "DREAMWARE Admin", role: "Brand administrator · fixture session", initials: "DA", allowedOrganizationIds: ["org_dreamware_canada", "org_dreamware_ontario", "org_dreamware_toronto"] },
  ],
  organizations,
};
const metrics = [
  { label: "Published capabilities", value: "18", detail: "11 skills · 7 workers", tone: "positive" as const },
  { label: "Active organizations", value: "4", detail: "Fixture hierarchy", tone: "neutral" as const },
  { label: "Governance review", value: "3", detail: "1 high-priority item", tone: "attention" as const },
  { label: "Policy health", value: "Not connected", detail: "Awaiting live health adapter", tone: "neutral" as const },
];
const capabilities: CapabilitySummary[] = [
  { id: "cap_knowledge_curator", name: "Knowledge Curator", kind: "Worker", version: "v1.4", state: "Published", scope: "Organization", updated: "8 min ago" },
  { id: "cap_correction_review", name: "Correction Review", kind: "Skill", version: "v2.1", state: "Review", scope: "Platform", updated: "24 min ago" },
  { id: "cap_policy_explainer", name: "Policy Explainer", kind: "Worker", version: "v1.2", state: "Published", scope: "Platform", updated: "2 hr ago" },
  { id: "cap_source_verifier", name: "Source Verifier", kind: "Skill", version: "v3.0", state: "Draft", scope: "Organization", updated: "Yesterday" },
];
const reviews: ReviewItem[] = [
  { id: "review_041", title: "Publish Correction Review v2.1", category: "Capability", requestedBy: "Aisha Rahman", age: "24 min", risk: "Medium" },
  { id: "review_042", title: "Approve finance knowledge source", category: "Company Brain", requestedBy: "Marco Silva", age: "1 hr", risk: "High" },
  { id: "review_043", title: "Expand EMEA worker scope", category: "Governance", requestedBy: "Nina Chen", age: "3 hr", risk: "Low" },
];
const activity: ActivityItem[] = [
  { id: "activity_301", actor: "Knowledge Curator", action: "indexed publication", target: "Customer support handbook", time: "2026-08-26T07:57:00.000Z", timeLabel: "8 min ago" },
  { id: "activity_302", actor: "Aisha Rahman", action: "submitted correction", target: "Expense approval policy", time: "2026-08-26T07:41:00.000Z", timeLabel: "24 min ago" },
  { id: "activity_303", actor: "Policy Engine", action: "denied scope expansion", target: "Finance Operations worker", time: "2026-08-26T07:24:00.000Z", timeLabel: "41 min ago" },
];
const sections: WorkspaceSection[] = [
  { id: "overview", label: "Overview", short: "OV", href: "/" },
  { id: "organizations", label: "Organizations", short: "OR", href: "/organizations" },
  { id: "capabilities", label: "Capabilities", short: "CA", href: "/capabilities" },
  { id: "brain", label: "Company Brain", short: "CB", href: "/brain" },
  { id: "governance", label: "Governance", short: "GO", href: "/governance" },
  { id: "audit", label: "Audit", short: "AU", href: "/audit" },
];
function findOrganization(orgId: string) { return organizations.find((item) => item.id === orgId); }
function denied<T>(message: string): AdapterResult<T> { return { denied: true, reasonKey: "ORG_FORBIDDEN", message, correlationId: "fixture-scope" }; }
export const fixtureWorkspaceAdapter: PlatformWorkspaceAdapter = {
  async loadOverview(orgId) {
    const organization = findOrganization(orgId);
    if (!organization) return denied("This organization is not available in the fixture session.");
    return structuredClone({ organization, source: fixtureSource, metrics, capabilities: capabilities.map((item) => item.scope === "Organization" ? { ...item, scope: organization.name } : item), reviews, activity } satisfies PlatformOverview);
  },
  async loadWorkspaceContext() { return structuredClone(workspaceContext); },
  async loadAllowedWorkspaces() { return structuredClone(sections); },
  async loadCapabilities(orgId) {
    const organization = findOrganization(orgId);
    if (!organization) return denied("This organization is not available in the fixture session.");
    return capabilities.map((item) => item.scope === "Organization" ? { ...item, scope: organization.name } : structuredClone(item));
  },
  async loadReviews(orgId) { return findOrganization(orgId) ? structuredClone(reviews) : denied("This organization is not available in the fixture session."); },
  async loadActivity(orgId) { return findOrganization(orgId) ? structuredClone(activity) : denied("This organization is not available in the fixture session."); },
  async loadOrganization(orgId) { const result = findOrganization(orgId); return result ? structuredClone(result) : denied("This organization is not available in the fixture session."); },
};
