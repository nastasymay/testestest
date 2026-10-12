import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';

const password = 'test-research-password-only';
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'research-test-'));
  let app;
  async function start() {
    app = createApp({ dataDir: dir, adminPassword: password, secureCookies: false });
    await new Promise(done => app.server.listen(0, '127.0.0.1', done));
    return `http://127.0.0.1:${app.server.address().port}`;
  }
  const base = await start();
  t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const adminCookie = (await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })).headers.get('set-cookie').split(';')[0];
  const invitation = await (await fetch(base + '/api/admin/invitation', { headers: { cookie: adminCookie } })).json();
  const accessCookie = (await fetch(base + invitation.path, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  const post = (path, body, extra = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: accessCookie, ...extra }, body: JSON.stringify(body) });
  const session = async () => (await post('/api/sessions', { width: 1440, height: 900 })).json();
  const login = async () => (await post('/api/admin/login', { password })).headers.get('set-cookie').split(';')[0];
  return { base, post, session, login, accessCookie, invitation, restart: async () => { await app.close(); return start(); } };
}
const event = (seq, type, data, atMs = seq * 1000) => ({ seq, type, data, atMs });

test('invitation gates the prototype and sessions, and does not grant admin access', async t => {
  const c = await setup(t);
  assert.equal((await fetch(c.base + '/')).status, 403);
  assert.equal((await fetch(c.base + '/app.js')).status, 403);
  assert.equal((await fetch(c.base + '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(c.base + '/invite/not-a-valid-key')).status, 404);
  assert.equal((await fetch(c.base + '/api/admin/invitation')).status, 401);
  assert.equal((await fetch(c.base + '/api/admin/sessions', { headers: { cookie: c.accessCookie } })).status, 401);
  const page = await fetch(c.base + '/', { headers: { cookie: c.accessCookie } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('x-robots-tag'), /noindex/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.match(await (await fetch(c.base + '/robots.txt')).text(), /Disallow: \//);
});

test('disabling and replacing invitation revokes previous links and cookies, preserving results', async t => {
  const c = await setup(t), s = await c.session(), cookie = await c.login();
  assert.equal((await c.post('/api/admin/invitation', { action: 'disable' }, { Cookie: cookie })).status, 200);
  assert.equal((await fetch(c.base + c.invitation.path, { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(c.base + '/', { headers: { cookie: c.accessCookie } })).status, 403);
  const base = await c.restart();
  assert.equal((await fetch(base + '/', { headers: { cookie: c.accessCookie } })).status, 403);
  const renewal = await fetch(base + '/api/admin/invitation', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'renew' }) });
  const fresh = await renewal.json();
  assert.notEqual(fresh.path, c.invitation.path);
  assert.equal((await fetch(base + c.invitation.path, { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(base + '/', { headers: { cookie: c.accessCookie } })).status, 403);
  const invite = await fetch(base + fresh.path, { redirect: 'manual' });
  assert.equal(invite.status, 303);
  const newCookie = invite.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/', { headers: { cookie: newCookie } })).status, 200);
  const results = await (await fetch(base + '/api/admin/sessions', { headers: { cookie } })).json();
  assert.equal(results.sessions[0].id, s.id);
});

test('participant page and health are available; admin data requires authentication', async t => {
  const c = await setup(t);
  const page = await fetch(c.base + '/', { headers: { cookie: c.accessCookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Исследование/);
  assert.equal((await fetch(c.base + '/health')).status, 200);
  assert.equal((await fetch(c.base + '/api/admin/sessions')).status, 401);
  assert.equal((await fetch(c.base + '/api/admin/export.json')).status, 401);
  assert.equal((await c.post('/api/admin/login', { password: 'wrong' })).status, 401);
  assert.equal((await fetch(c.base + '/.data/admin-password')).status, 404);
});

test('participant token isolates sessions and batch validation is atomic', async t => {
  const c = await setup(t), a = await c.session(), b = await c.session();
  const path = `/api/sessions/${a.id}/events`;
  assert.equal((await c.post(path, { token: b.token, events: [event(1, 'study_started', {})] })).status, 401);
  assert.equal((await c.post(path, { token: a.token, events: [event(1, 'study_started', {}), event(2, 'state_view', { state: 'invalid' })] })).status, 400);
  const cookie = await c.login();
  const detail = await (await fetch(c.base + `/api/admin/sessions/${a.id}`, { headers: { cookie } })).json();
  assert.equal(detail.events.length, 0);
});

test('records the two task paths, durations, self reports and screen evidence', async t => {
  const c = await setup(t), s = await c.session();
  const events = [
    event(1, 'study_started', {}), event(2, 'task_started', { task: 1 }),
    event(3, 'click', { task: 1, action: 'product', target: 'Диадок' }),
    event(4, 'state_view', { task: 1, state: 'diadoc.current', organization: 'mine' }),
    event(5, 'task_result', { task: 1, outcome: 'completed', answer: 'Общий плюс, до 10 ноября 2026' }),
    event(6, 'task_started', { task: 2 }),
    event(7, 'state_view', { task: 2, state: 'organization.menu', organization: 'mine' }),
    event(8, 'state_view', { task: 2, state: 'extern.current', organization: 'romashka' }),
    event(9, 'task_result', { task: 2, outcome: 'completed', answer: 'Оптимальный плюс' }),
    event(10, 'study_completed', {})
  ];
  assert.equal((await c.post(`/api/sessions/${s.id}/events`, { token: s.token, events })).status, 200);
  const cookie = await c.login();
  const detail = await (await fetch(c.base + `/api/admin/sessions/${s.id}`, { headers: { cookie } })).json();
  assert.equal(detail.status, 'completed');
  assert.equal(detail.clicks, 1);
  assert.equal(detail.tasks[0].durationMs, 3000);
  assert.equal(detail.tasks[0].timeToRelevantScreenMs, 2000);
  assert.equal(detail.tasks[1].relevantScreenVisited, true);
  assert.equal(detail.tasks[1].answer, 'Оптимальный плюс');
  const exported = await (await fetch(c.base + '/api/admin/export.json', { headers: { cookie } })).json();
  assert.equal(exported.sessions[0].events.length, 10);
});

test('retries are idempotent; a duplicate sequence cannot overwrite a recorded event', async t => {
  const c = await setup(t), s = await c.session();
  const path = `/api/sessions/${s.id}/events`;
  const events = [event(1, 'task_started', { task: 1 }), event(2, 'task_result', { task: 1, outcome: 'gave_up' })];
  await c.post(path, { token: s.token, events });
  await c.post(path, { token: s.token, events });
  await c.post(path, { token: s.token, events: [event(2, 'task_result', { task: 1, outcome: 'completed' })] });
  const cookie = await c.login();
  const detail = await (await fetch(c.base + `/api/admin/sessions/${s.id}`, { headers: { cookie } })).json();
  assert.equal(detail.events.length, 2);
  assert.equal(detail.tasks[0].outcome, 'gave_up');
  assert.equal(detail.status, 'in_progress');
  assert.equal(detail.tasks[1].outcome, 'unrun');
});

test('screen evidence is restricted to the current task and selected organization', async t => {
  const c = await setup(t), s = await c.session();
  const events = [event(1, 'state_view', { state: 'diadoc.current' }), event(2, 'task_started', { task: 1 }), event(3, 'task_result', { task: 1, outcome: 'completed' }), event(4, 'task_started', { task: 2 }), event(5, 'state_view', { state: 'extern.current', organization: 'mine' }), event(6, 'task_result', { task: 2, outcome: 'completed' })];
  await c.post(`/api/sessions/${s.id}/events`, { token: s.token, events });
  const cookie = await c.login();
  const detail = await (await fetch(c.base + `/api/admin/sessions/${s.id}`, { headers: { cookie } })).json();
  assert.equal(detail.tasks[0].relevantScreenVisited, false);
  assert.equal(detail.tasks[1].relevantScreenVisited, false);
  assert.equal(detail.status, 'in_progress');
});

test('results survive a server restart and CSV escapes formula-like answers', async t => {
  const c = await setup(t), s = await c.session();
  await c.post(`/api/sessions/${s.id}/events`, { token: s.token, events: [event(1, 'task_started', { task: 1 }), event(2, 'task_result', { task: 1, outcome: 'gave_up', answer: '=1+1,"quote"' })] });
  const cookie = await c.login();
  const base = await c.restart();
  const csv = await (await fetch(base + '/api/admin/export.csv', { headers: { cookie } })).text();
  assert.match(csv, /'=1\+1,""quote""/);
  const { sessions } = await (await fetch(base + '/api/admin/sessions', { headers: { cookie } })).json();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].tasks[0].outcome, 'gave_up');
});

test('rejects cross-origin writes and malformed event packets', async t => {
  const c = await setup(t);
  assert.equal((await c.post('/api/sessions', {}, { Origin: 'https://other.example' })).status, 403);
  const s = await c.session();
  assert.equal((await c.post(`/api/sessions/${s.id}/events`, { token: s.token, events: [event(1, 'task_result', { task: 5, outcome: 'completed' })] })).status, 400);
  assert.equal((await c.post(`/api/sessions/${s.id}/events`, { token: s.token, events: [event(1, 'task_result', { task: 1, outcome: 'unknown' })] })).status, 400);
});
