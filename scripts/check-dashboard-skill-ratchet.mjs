import { execFileSync } from 'node:child_process';

const baseRef = process.env.DASHBOARD_SKILL_RATCHET_BASE_REF;
if (!baseRef) {
  console.error('DASHBOARD_SKILL_RATCHET_BASE_REF is required');
  process.exit(2);
}

const base = execFileSync('git', ['merge-base', 'HEAD', `origin/${baseRef}`], { encoding: 'utf8' }).trim();
const diff = execFileSync(
  'git',
  [
    'diff',
    '--unified=0',
    base,
    'HEAD',
    '--',
    'apps/platform-web',
    'apps/brand-web',
    'packages/ui/src',
  ],
  { encoding: 'utf8' },
);

const rawColor = /(#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|(?:^|[:;,\s(])(?:white|black)(?=[;,\s)]))/i;
const ignoredFiles = [
  /(?:^|\/)tokens(?:\/|$)/,   // tokens/ directory (CSS token files)
  /(?:^|\/)tokens\.ts$/,       // tokens.ts — the canonical token definition file (raw values by design)
  /\.test\.(?:tsx?|jsx?)$/,
  /\.spec\.(?:tsx?|jsx?)$/,
];

let file = '';
const violations = [];

for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) {
    file = line.slice(6);
    continue;
  }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  if (!file || !/\.(?:css|scss|tsx?|jsx?)$/i.test(file)) continue;
  if (ignoredFiles.some((pattern) => pattern.test(file))) continue;

  const source = line.slice(1);
  const normalized = source.replace(/\bwhite-space\b/gi, '');
  if (rawColor.test(normalized)) {
    violations.push({ file, source: source.trim() });
  }
}

if (violations.length) {
  console.error('SKILL-UI-001 violation: new dashboard code must not introduce raw colors. Use semantic EXPADIO CSS variables.');
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.source}`);
  }
  process.exit(1);
}

console.log(`Dashboard skill ratchet: no new raw dashboard colors (merge base ${base}).`);
