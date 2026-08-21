#!/usr/bin/env node
/**
 * Runs the API and the web app together with prefixed, colour-coded output.
 * Ctrl-C stops both.
 *
 *   npm run dev
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const app of ['backend', 'frontend']) {
  if (!fs.existsSync(path.join(root, app, '.env'))) {
    console.error(`\n  ${app}/.env is missing. Run:  npm run env:init\n`);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(root, app, 'node_modules'))) {
    console.error(`\n  ${app} dependencies are not installed. Run:  npm run install:all\n`);
    process.exit(1);
  }
}

const TARGETS = [
  { name: 'api', color: '\x1b[36m', cwd: 'backend' },
  { name: 'web', color: '\x1b[35m', cwd: 'frontend' },
];
const RESET = '\x1b[0m';

const children = TARGETS.map(({ name, color, cwd }) => {
  const child = spawn('npm', ['run', 'dev'], {
    cwd: path.join(root, cwd),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = `${color}[${name}]${RESET} `;
  const relay = (stream, target) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) target.write(prefix + line + '\n');
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`${prefix}exited with code ${code}`);
    }
    shutdown();
  });
  return child;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
  setTimeout(() => process.exit(0), 300).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
