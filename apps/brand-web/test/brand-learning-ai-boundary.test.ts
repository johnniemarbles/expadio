import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Brand Learning AI delegates execution to Platform authenticated API', () => {
  const proxy = read('../lib/platform-learning-ai.ts');
  const route = read('../app/api/learning/ai/requests/route.ts');
  assert.match(proxy, /getToken\(\)/);
  assert.match(proxy, /Bearer/);
  assert.match(proxy, /account/);
  assert.match(proxy, /organizationId/);
  assert.match(route, /platformLearningAiFetch/);
});

test('Brand AI surface does not own providers, credentials or durable output storage', () => {
  const proxy = read('../lib/platform-learning-ai.ts');
  const route = read('../app/api/learning/ai/requests/route.ts');
  const source = proxy + route;
  assert.doesNotMatch(source, /openai|gemini|provider-registry|credential-lease|SupabaseDurableArtifactStore/i);
});

test('AI enablement remains an admin-gated Learning setting', () => {
  const settings = read('../app/api/learning/ai/settings/route.ts');
  assert.match(settings, /updateLearningAiSettings/);
  assert.match(settings, /hasLearningAdmin/);
});
