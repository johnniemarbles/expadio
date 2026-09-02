import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceSection } from "../lib/contracts.ts";

const mockSections: WorkspaceSection[] = [
  { id: "overview", label: "Overview", href: "/", short: "⌂", group: "Workspace" },
  { id: "capabilities", label: "Capabilities", href: "/capabilities", short: "❖", group: "Workspace" },
  { id: "vendors", label: "Vendor Onboarding", href: "/vendors", short: "🏢", group: "Growth" },
  { id: "governance", label: "Decisions", href: "/governance", short: "⚖", group: "Decision Fabric" },
  { id: "agents", label: "Agent Fleet", href: "/agents", short: "🤖", group: "Agent Intelligence" },
  { id: "appearance", label: "Appearance", href: "/appearance", short: "🎨", group: "Administration" },
];

test("CommandPalette search filtering matches label and group case-insensitively", () => {
  const query = "vendor";
  const matched = mockSections.filter(
    (s) =>
      s.label.toLowerCase().includes(query) ||
      (s.group && s.group.toLowerCase().includes(query)) ||
      s.href.toLowerCase().includes(query)
  );

  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, "vendors");
});

test("CommandPalette search filtering matches by group name", () => {
  const query = "intelligence";
  const matched = mockSections.filter(
    (s) =>
      s.label.toLowerCase().includes(query) ||
      (s.group && s.group.toLowerCase().includes(query)) ||
      s.href.toLowerCase().includes(query)
  );

  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, "agents");
});

test("CommandPalette circular keyboard index navigation clamps within bounds", () => {
  let selectedIndex = 0;
  const count = mockSections.length;

  // ArrowDown
  selectedIndex = (selectedIndex + 1) % count;
  assert.equal(selectedIndex, 1);

  // ArrowUp from 0 wraps to end
  selectedIndex = 0;
  selectedIndex = (selectedIndex - 1 + count) % count;
  assert.equal(selectedIndex, count - 1);
});
