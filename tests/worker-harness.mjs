import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

export async function startWorker({ stateDir, initialized = false } = {}) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = stateDir || mkdtempSync(join(tmpdir(), 'kontur-worker-test-'));
  const config = JSON.parse(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'));
  config.main = resolve(root, 'worker.mjs');
  config.assets.directory = resolve(root, 'public');
  config.d1_databases[0].migrations_dir = resolve(root, 'migrations');
  const configPath = join(dir, 'wrangler.json');
  writeFileSync(configPath, JSON.stringify(config));
  writeFileSync(join(dir, '.dev.vars'), 'ADMIN_PASSWORD=browser-test-password\nPARTICIPANT_PASSWORD=participant-test-password\nCOOKIE_SECRET=local-test-only-cookie-key-32-characters\n', { mode: 0o600 });
  const env = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(dir, 'logs'), XDG_CONFIG_HOME: join(dir, 'config') };
  const cli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  if (!initialized) {
    const migrate = spawnSync(process.execPath, [cli, 'd1', 'migrations', 'apply', 'kontur-research', '--local', '--config', configPath, '--persist-to', join(dir, 'state')], { cwd: root, env, encoding: 'utf8', timeout: 60000 });
    if (migrate.status !== 0) throw new Error('Local D1 migration failed:\n' + migrate.stdout + migrate.stderr);
  }
  const port = await new Promise(done => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)); }); });
  const child = spawn(process.execPath, [cli, 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--config', configPath, '--persist-to', join(dir, 'state')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
  const stop = async () => {
    if (child.exitCode !== null) return;
    await new Promise(done => { child.once('exit', done); child.kill('SIGTERM'); });
  };
  const url = `http://127.0.0.1:${port}`;
  try {
    let healthy = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) break;
      try { if ((await fetch(url + '/health')).ok) { healthy = true; break; } } catch {}
      await new Promise(done => setTimeout(done, 200));
    }
    if (!healthy) throw new Error('Local Worker did not become ready:\n' + logs);
  } catch (error) { await stop(); throw error; }
  return { url, dir, stop, cleanup: () => rmSync(dir, { recursive: true, force: true }), logs: () => logs };
}
