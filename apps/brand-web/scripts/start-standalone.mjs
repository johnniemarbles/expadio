import { access, cp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const appName = basename(appRoot);
const standaloneRoot = join(appRoot, '.next', 'standalone');
const sourceStatic = join(appRoot, '.next', 'static');

async function firstExisting(paths) {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next supported Next.js standalone layout.
    }
  }
  return null;
}

const serverCandidates = [
  join(standaloneRoot, 'server.js'),
  join(standaloneRoot, 'apps', appName, 'server.js'),
];

const serverPath = await firstExisting(serverCandidates);
if (!serverPath) {
  throw new Error(
    `Next.js standalone server was not found. Checked: ${serverCandidates.join(', ')}`,
  );
}

await access(sourceStatic);

const runtimeRoot = dirname(serverPath);
const targetStatic = join(runtimeRoot, '.next', 'static');

await rm(targetStatic, { recursive: true, force: true });
await mkdir(dirname(targetStatic), { recursive: true });
await cp(sourceStatic, targetStatic, { recursive: true });

console.log(`Starting Next.js standalone server: ${serverPath}`);

const child = spawn(process.execPath, [serverPath], {
  cwd: runtimeRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    HOSTNAME: process.env.HOSTNAME || '0.0.0.0',
  },
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error('Failed to start Next.js standalone server:', error);
  process.exit(1);
});
