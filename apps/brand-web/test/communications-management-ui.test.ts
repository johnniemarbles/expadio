import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/(workspace)/communications/page.tsx', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../app/(workspace)/communications/CommunicationsManager.tsx', import.meta.url), 'utf8');

test('Brand Communications workspace exposes real template, sender, and suppression controls', () => {
  assert.match(page, /<CommunicationsManager \/>/);
  assert.match(manager, /fetch\('\/api\/communications\/templates'/);
  assert.match(manager, /fetch\('\/api\/communications\/senders'/);
  assert.match(manager, /fetch\('\/api\/communications\/suppressions\?status=ACTIVE&limit=100'/);
  assert.match(manager, /method:\s*'POST'/);
  assert.match(manager, /method:\s*'PATCH'/);
  assert.match(manager, /method:\s*'DELETE'/);
});

test('Brand management UI preserves governed lifecycle boundaries', () => {
  assert.match(manager, /Draft template created\. Publication remains a separate governed step/);
  assert.match(manager, /verificationStatus/);
  assert.match(manager, /verificationStatus === 'VERIFIED'/);
  assert.match(manager, /inherited tenant or platform suppression state/);
  assert.doesNotMatch(manager, /provider_registry|connector_key|authToken|apiKey|secretResolver|wrapping-key/);
});
