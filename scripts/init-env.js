#!/usr/bin/env node
/**
 * Creates backend/.env and frontend/.env from their .env.example templates and
 * generates a strong JWT_SECRET. Existing .env files are left alone.
 *
 *   npm run env:init
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const app of ['backend', 'frontend']) {
  const envPath = path.join(root, app, '.env');
  const examplePath = path.join(root, app, '.env.example');

  if (!fs.existsSync(examplePath)) {
    console.error(`  missing  ${app}/.env.example`);
    process.exitCode = 1;
    continue;
  }
  if (fs.existsSync(envPath)) {
    console.log(`  kept     ${app}/.env (already exists)`);
    continue;
  }

  let contents = fs.readFileSync(examplePath, 'utf8');
  if (app === 'backend') {
    const secret = crypto.randomBytes(48).toString('hex');
    contents = contents.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${secret}"`);
  }
  fs.writeFileSync(envPath, contents);
  console.log(`  created  ${app}/.env${app === 'backend' ? ' (with a fresh JWT_SECRET)' : ''}`);
}
