import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

const runtime = read("../lib/workflow-runtime.ts");
const client = read("../app/(shell)/crm/CrmClient.tsx");

test("reaching the terminal stage auto-completes the instance", () => {
  assert.match(runtime, /terminalStageKey/);
  assert.match(runtime, /state: 'COMPLETED'/);
  // Completion is its own append-only transition, not a silent update.
  assert.match(runtime, /toState: 'COMPLETED'/);
  assert.match(runtime, /auto-complete: terminal stage/);
  assert.match(runtime, /completedAt: now/);
});

test("the Cases surface shows a completed workflow as done", () => {
  assert.match(client, /wf\.state === "COMPLETED"/);
  assert.match(client, /✓ Completed/);
});
