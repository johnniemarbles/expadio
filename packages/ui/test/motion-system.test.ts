import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testDir = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(testDir, '..');

function readUiSource(path: string): string {
  return readFileSync(resolve(uiRoot, path), 'utf8');
}

test('MotionPanel closed state is removed from layout and assistive navigation', () => {
  const source = readUiSource('src/motion/MotionPanel.tsx');

  assert.match(source, /aria-hidden=\{!open\}/u);
  assert.match(source, /data-state=\{open \? 'open' : 'closed'\}/u);
  assert.match(source, /hidden=\{!open\}/u);
});

test('reduced motion tokens also override scoped Platform and Brand themes', () => {
  const source = readUiSource('src/tokens/motion.css');

  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(source, /\[data-expadio-theme="platform"\]/u);
  assert.match(source, /\[data-expadio-theme="brand"\]/u);
  assert.match(source, /--theme-motion-distance-micro:\s*0px/u);
  assert.match(source, /--theme-motion-distance-small:\s*0px/u);
  assert.match(source, /--theme-motion-distance-panel:\s*0px/u);
});

test('MotionStatus pulse is governed by motion tokens', () => {
  const source = readUiSource('src/motion/MotionStatus.module.css');

  assert.doesNotMatch(source, /2\.1s/u);
  assert.doesNotMatch(source, /ease-in-out/u);
  assert.match(source, /var\(--theme-motion-data\)/u);
  assert.match(source, /var\(--theme-easing\)/u);
});
