import { access, cp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const standaloneRoot = join(appRoot, '.next', 'standalone');
const serverPath = join(standaloneRoot, 'server.js');
const sourceStatic = join(appRoot, '.next', 'static');
const targetStatic = join(standaloneRoot, '.next', 'static');

await access(serverPath);
await access(sourceStatic);

await rm(targetStatic, { recursive: true, force: true });
await mkdir(dirname(targetStatic), { recursive: true });
await cp(sourceStatic, targetStatic, { recursive: true });

const child = spawn(process.execPath, [serverPath], {
  cwd: standaloneRoot,
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
