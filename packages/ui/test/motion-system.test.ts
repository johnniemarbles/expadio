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


test('shared motion tokens do not target CSS module class-name substrings', () => {
  const source = readUiSource('src/tokens/motion.css');

  assert.doesNotMatch(source, /\[class\*=/u);
  assert.match(source, /\.expadioMotionEnter/u);
  assert.match(source, /\.expadioMotionPanelIn/u);
  assert.match(source, /\.expadioMotionRowIn/u);
  assert.match(source, /\.expadioMotionTab/u);
});


test('governed theme emits the complete runtime motion token set', () => {
  const source = readUiSource('src/theme.ts');
  const governed = readUiSource('src/governed-theme.ts');

  for (const token of [
    '--theme-motion-instant',
    '--theme-motion-fast',
    '--theme-motion-normal',
    '--theme-motion-slow',
    '--theme-motion-panel',
    '--theme-motion-data',
    '--theme-motion-distance-micro',
    '--theme-motion-distance-small',
    '--theme-motion-distance-panel',
    '--theme-easing',
    '--theme-easing-emphasis',
    '--theme-easing-linear',
  ]) {
    assert.match(source, new RegExp(token));
  }

  for (const field of [
    'instant',
    'panel',
    'data',
    'distanceMicro',
    'distanceSmall',
    'distancePanel',
    'easingEmphasis',
    'easingLinear',
  ]) {
    assert.match(governed, new RegExp(`'${field}'`));
  }
});


test('semantic motion primitives are exported and token governed', () => {
  const index = readUiSource('src/motion/index.ts');
  const progressCss = readUiSource('src/motion/MotionProgress.module.css');
  const activityCss = readUiSource('src/motion/MotionActivity.module.css');
  const feedbackCss = readUiSource('src/motion/MotionFeedback.module.css');

  for (const exported of ['MotionProgress', 'MotionActivity', 'MotionFeedback']) {
    assert.match(index, new RegExp(exported));
  }

  for (const source of [progressCss, activityCss, feedbackCss]) {
    assert.match(source, /var\(--theme-motion-/u);
    assert.match(source, /var\(--theme-easing\)/u);
    assert.match(source, /prefers-reduced-motion: reduce/u);
    assert.doesNotMatch(source, /ease-in-out/u);
  }
});
