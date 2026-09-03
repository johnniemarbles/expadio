import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const detailClient = read('../app/(workspace)/leads/capture/[id]/LeadDetailClient.tsx');
const detailPage = read('../app/(workspace)/leads/capture/[id]/page.tsx');
const analyticsClient = read('../app/(workspace)/leads/analytics/LeadAnalyticsClient.tsx');
const analyticsPage = read('../app/(workspace)/leads/analytics/page.tsx');
const captureClient = read('../app/(workspace)/leads/capture/DemandCaptureClient.tsx');

test('lead detail page is module-gated and resolves the brand context', () => {
  assert.match(detailPage, /resolveBrandContext/);
  assert.match(detailPage, /loadTenantProductModule/);
  assert.match(detailPage, /lead-management/);
  assert.match(detailPage, /availability.*ACTIVE|ACTIVE.*availability/s);
});

test('lead detail page renders the client component with the captureLeadId param', () => {
  assert.match(detailPage, /LeadDetailClient/);
  assert.match(detailPage, /captureLeadId/);
  // UUID validation before rendering
  assert.match(detailPage, /UUID\.test|notFound/);
});

test('LeadDetailClient loads lead, activities and tasks from their APIs', () => {
  assert.match(detailClient, /\/api\/leads\/capture\//);
  assert.match(detailClient, /\/activities/);
  assert.match(detailClient, /\/tasks/);
  assert.match(detailClient, /Promise\.all/);
});

test('LeadDetailClient shows activity timeline with add-note form', () => {
  assert.match(detailClient, /Timeline/);
  assert.match(detailClient, /AddNoteForm/);
  assert.match(detailClient, /\/api\/leads\/capture\/.*\/activities/);
  assert.match(detailClient, /type.*NOTE|NOTE.*type/s);
});

test('LeadDetailClient shows task board with add-task form and status cycling', () => {
  assert.match(detailClient, /Task board|AddTaskForm/);
  assert.match(detailClient, /\/api\/leads\/tasks\//);
  assert.match(detailClient, /PATCH/);
  assert.match(detailClient, /Mark done|DONE/);
  assert.match(detailClient, /priority/);
});

test('LeadDetailClient renders escalated and due-date badges on tasks', () => {
  assert.match(detailClient, /escalatedAt/);
  assert.match(detailClient, /ESCALATED/);
  assert.match(detailClient, /dueAt/);
  assert.match(detailClient, /PRIORITY_COLORS|priority.*color|color.*priority/s);
});

test('LeadDetailClient shows verification state badge on lead summary', () => {
  assert.match(detailClient, /verificationState/);
  assert.match(detailClient, /VERIFIED/);
  assert.match(detailClient, /projectedToCrm/);
});

test('analytics page is module-gated and uses the brand context', () => {
  assert.match(analyticsPage, /resolveBrandContext/);
  assert.match(analyticsPage, /lead-management/);
  assert.match(analyticsPage, /LeadAnalyticsClient/);
});

test('LeadAnalyticsClient fetches from the analytics API', () => {
  assert.match(analyticsClient, /\/api\/leads\/analytics/);
  assert.match(analyticsClient, /funnel/);
  assert.match(analyticsClient, /taskQueue/);
  assert.match(analyticsClient, /attributionSources/);
});

test('LeadAnalyticsClient shows KPI strip with totals and escalation count', () => {
  assert.match(analyticsClient, /Total leads/);
  assert.match(analyticsClient, /Verified/);
  assert.match(analyticsClient, /Open tasks/);
  assert.match(analyticsClient, /Escalated/);
});

test('LeadAnalyticsClient shows funnel, task queue, and attribution tabs', () => {
  assert.match(analyticsClient, /Capture funnel/);
  assert.match(analyticsClient, /Task queue/);
  assert.match(analyticsClient, /Attribution/);
});

test('demand capture inbox links to the lead detail page', () => {
  assert.match(captureClient, /leads\/capture\/${lead\.captureLeadId}|captures\/\[id\]|captureLeadId.*href/s);
  assert.match(captureClient, /View detail/);
  assert.match(captureClient, /Link/);
});

test('capture page header links to the analytics dashboard', () => {
  const capturePage = read('../app/(workspace)/leads/capture/page.tsx');
  assert.match(capturePage, /leads\/analytics/);
  assert.match(capturePage, /Analytics/);
});
