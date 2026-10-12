// Cloudflare Builds runs this script; no Cloudflare credentials belong in Git.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const id = process.env.D1_DATABASE_ID || config.d1_databases[0].database_id;
if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '') || id === '00000000-0000-0000-0000-000000000000') {
  console.error('Create the kontur-research D1 database, then set D1_DATABASE_ID in Cloudflare build variables. It is the database UUID, not a secret.');
  process.exit(1);
}
config.d1_databases[0].database_id = id;
if (process.env.WORKER_NAME) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(process.env.WORKER_NAME)) throw new Error('Invalid WORKER_NAME');
  config.name = process.env.WORKER_NAME;
}
writeFileSync(new URL('../.wrangler.deploy.json', import.meta.url), JSON.stringify(config, null, 2));
for (const args of [
  ['d1', 'migrations', 'apply', 'kontur-research', '--remote', '--config', '.wrangler.deploy.json'],
  ['deploy', '--config', '.wrangler.deploy.json']
]) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], { stdio: 'inherit', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' } });
  if (result.status !== 0) process.exit(result.status || 1);
}
