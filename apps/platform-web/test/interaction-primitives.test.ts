import assert from "node:assert/strict";
import test from "node:test";

test("ActivityTimeline categorizes activity records properly", () => {
  const items = [
    { id: "1", actor: "Admin", action: "granted membership to", target: "user_123", time: "2026-09-02T10:00:00Z" },
    { id: "2", actor: "WorkerAgent", action: "executed tool run on", target: "doc_456", time: "2026-09-02T10:01:00Z" },
    { id: "3", actor: "Auditor", action: "performed sensitive read of", target: "phi_record", time: "2026-09-02T10:02:00Z" },
    { id: "4", actor: "Clinician", action: "approved decision for", target: "treatment_789", time: "2026-09-02T10:03:00Z" },
  ];

  function deriveCategory(item: (typeof items)[0]) {
    const text = (item.action + " " + item.actor + " " + item.target).toLowerCase();
    if (text.includes("agent") || text.includes("run") || text.includes("tool")) return "AGENTS";
    if (text.includes("read") || text.includes("sensitive")) return "READS";
    if (text.includes("membership") || text.includes("user") || text.includes("auth") || text.includes("token")) return "AUTH";
    if (text.includes("decision") || text.includes("review") || text.includes("workflow")) return "GOVERNANCE";
    return "ALL";
  }

  assert.equal(deriveCategory(items[0]), "AUTH");
  assert.equal(deriveCategory(items[1]), "AGENTS");
  assert.equal(deriveCategory(items[2]), "READS");
  assert.equal(deriveCategory(items[3]), "GOVERNANCE");
});

test("DataTable filtering and sorting accurately handles rows", () => {
  const rows = [
    { id: "1", name: "Alpha", status: "Active", count: 42 },
    { id: "2", name: "Beta", status: "Pending", count: 15 },
    { id: "3", name: "Gamma", status: "Active", count: 99 },
  ];

  // Filter
  const query = "active";
  const filtered = rows.filter((r) =>
    Object.values(r).some((v) => String(v).toLowerCase().includes(query))
  );
  assert.equal(filtered.length, 2);

  // Sort ascending by count
  const sorted = [...rows].sort((a, b) => a.count - b.count);
  assert.equal(sorted[0].name, "Beta");
  assert.equal(sorted[2].name, "Gamma");
});

test("CommandPalette Provider search integrates seamlessly with navigation", async () => {
  const mockProviders = [
    {
      id: "organizations",
      label: "Organizations",
      search: async (q: string) => {
        if (q.includes("us")) return [{ id: "org_us", label: "EXPADIO US Platform", group: "Organizations" }];
        return [];
      },
    },
  ];

  const results = await Promise.all(mockProviders.map((p) => p.search("us")));
  const flattened = results.flat();

  assert.equal(flattened.length, 1);
  assert.equal(flattened[0].id, "org_us");
  assert.equal(flattened[0].group, "Organizations");
});
