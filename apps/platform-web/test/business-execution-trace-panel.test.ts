import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const panel = read('../app/(shell)/communications/BusinessExecutionTracePanel.tsx');
const page = read('../app/(shell)/execution-trace/page.tsx');

test('business execution trace panel calls the governed trace API with bounded filters', () => {
  assert.match(panel, /\/api\/execution\/trace/);
  assert.match(panel, /eventId/);
  assert.match(panel, /correlationId/);
  assert.match(panel, /aggregateType/);
  assert.match(panel, /aggregateId/);
  assert.match(panel, /aggregateType\.trim\(\) !== "" && aggregateId\.trim\(\) !== ""/);
  assert.match(panel, /method:\s*"POST"|fetch\(url\)/);
  assert.doesNotMatch(panel, /fetch\([^)]*,\s*\{\s*method:\s*["']POST["']/s);
  assert.doesNotMatch(panel, /fetch\([^)]*,\s*\{\s*method:\s*["']PATCH["']/s);
  assert.doesNotMatch(panel, /fetch\([^)]*,\s*\{\s*method:\s*["']DELETE["']/s);
});

test('execution trace page preserves workspace query context', () => {
  assert.match(page, /BusinessExecutionTracePanel/);
  assert.match(page, /params\.account/);
  assert.match(page, /params\.org/);
  assert.match(page, /queryString=\{q\}/);
  assert.match(page, /GET \/api\/execution\/trace/);
});
