import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('learner home exposes programs, transcript and credential wallet from governed runtime', () => {
  const page = read('../app/(workspace)/learn/page.tsx');
  assert.match(page, /listMyLearningPrograms/);
  assert.match(page, /listMyLearningCredentials/);
  assert.match(page, /loadMyLearningTranscript/);
  assert.match(page, /Credential wallet/);
  assert.match(page, /Programs/);
  assert.match(page, /Continue learning/);
});

test('credential detail can only resolve from signed-in learners own credential projection', () => {
  const page = read('../app/(workspace)/learn/credentials/[id]/page.tsx');
  assert.match(page, /listMyLearningCredentials/);
  assert.match(page, /subjectId: context\.subjectId/);
  assert.match(page, /subjectIssuer: context\.issuer/);
  assert.match(page, /credentials\.find\(\(entry\) => entry\.credentialId === id\)/);
  assert.doesNotMatch(page, /listLearningCredentials/);
  assert.doesNotMatch(page, /hasLearningAdmin/);
});

test('learner outcomes show renewal and expiry state without inventing a second credential status', () => {
  const home = read('../app/(workspace)/learn/page.tsx');
  const detail = read('../app/(workspace)/learn/credentials/[id]/page.tsx');
  assert.match(home, /credential\.effectiveStatus/);
  assert.match(home, /credential\.renewalDueAt/);
  assert.match(home, /credential\.expiresAt/);
  assert.match(detail, /credential\.effectiveStatus/);
  assert.match(detail, /credential\.revokedAt/);
  assert.match(detail, /credential\.revocationReason/);
});
