import { validateEvents, summarize, exportCsv } from './lib/research.mjs';

const encoder = new TextEncoder();
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
const error = (status, message) => { throw Object.assign(new Error(message), { status }); };
function response(status, data, headers = {}) {
  return new Response(typeof data === 'string' ? data : JSON.stringify(data), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = value => crypto.subtle.digest('SHA-256', encoder.encode(value)).then(hex);
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const cookie = (req, name) => (req.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1) || '';
const setCookie = (req, name, value, age, sameSite = 'Strict') => `${name}=${value}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${age}${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;
async function body(req) {
  if (!req.headers.get('Content-Type')?.startsWith('application/json')) error(415, 'Требуется JSON.');
  if (Number(req.headers.get('Content-Length')) > 100000) error(413, 'Запрос слишком большой.');
  const reader = req.body?.getReader();
  let chunks = [], size = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 100000) { await reader.cancel(); error(413, 'Запрос слишком большой.'); }
      chunks.push(value);
    }
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const data = JSON.parse(new TextDecoder().decode(buffer));
    if (!data || typeof data !== 'object' || Array.isArray(data)) error(400, 'Некорректный JSON.');
    return data;
  } catch { error(400, 'Некорректный JSON.'); }
}
async function loadInvitation(db) {
  // INSERT OR IGNORE chooses one persisted key even when two isolates initialize together.
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO settings(name,value) VALUES('invitation_key',?)").bind(random()),
    db.prepare("INSERT OR IGNORE INTO settings(name,value) VALUES('invitation_enabled','1')")
  ]);
  const rows = (await db.prepare("SELECT name,value FROM settings WHERE name IN ('invitation_key','invitation_enabled')").all()).results;
  const values = Object.fromEntries(rows.map(r => [r.name, r.value]));
  return { key: values.invitation_key, enabled: values.invitation_enabled === '1' };
}
async function eventsFor(db, id) {
  return (await db.prepare('SELECT seq, type, at_ms AS atMs, received_at AS receivedAt, data FROM events WHERE session_id=? ORDER BY seq').bind(id).all()).results.map(e => ({ ...e, data: JSON.parse(e.data) }));
}
async function list(db) {
  const rows = (await db.prepare('SELECT id, started_at, last_seen, status, viewport FROM sessions ORDER BY started_at DESC').all()).results;
  // One event query rather than one D1 round trip per participant.
  const events = (await db.prepare('SELECT session_id,seq,type,at_ms AS atMs,received_at AS receivedAt,data FROM events ORDER BY session_id,seq').all()).results;
  const groups = new Map();
  for (const { session_id, ...event } of events) {
    if (!groups.has(session_id)) groups.set(session_id, []);
    groups.get(session_id).push({ ...event, data: JSON.parse(event.data) });
  }
  return rows.map(row => ({ ...summarize(row, groups.get(row.id) || []), events: groups.get(row.id) || [] }));
}
async function route(req, env) {
  const url = new URL(req.url), path = url.pathname;
  if (req.method === 'GET' && path === '/robots.txt') return response(200, 'User-agent: *\nDisallow: /\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  if (req.method === 'POST' && req.headers.get('Origin') && req.headers.get('Origin') !== url.origin) error(403, 'Недопустимый источник запроса.');
  if (!env.DB || !env.ASSETS || typeof env.ADMIN_PASSWORD !== 'string' || env.ADMIN_PASSWORD.length < 12 || typeof env.PARTICIPANT_PASSWORD !== 'string' || env.PARTICIPANT_PASSWORD.length < 8 || typeof env.COOKIE_SECRET !== 'string' || env.COOKIE_SECRET.length < 32) {
    if (req.method === 'GET' && !path.startsWith('/api/') && path !== '/health') return response(503, '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Подготовка исследования</title><h1>Исследование ещё настраивается</h1><p>Исследователь завершает настройку доступа. Попробуйте открыть ссылку позже.</p></html>', { 'Content-Type': 'text/html; charset=utf-8' });
    error(503, 'Не завершена настройка базы и паролей исследования.');
  }
  // Primary session avoids stale reads after a previous request writes an event or revokes access.
  const db = env.DB.withSession('first-primary');
  const hmacKey = await crypto.subtle.importKey('raw', encoder.encode(env.COOKIE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sign = value => crypto.subtle.sign('HMAC', hmacKey, encoder.encode(value)).then(hex);
  const adminVersion = await sha(env.ADMIN_PASSWORD);
  const participantVersion = await sha(env.PARTICIPANT_PASSWORD);
  const authorize = async (name, scope) => {
    const [expires, signature] = cookie(req, name).split('.');
    return /^\d{13}$/.test(expires || '') && Number(expires) > Date.now() && equal(signature, await sign(`${scope}:${expires}`));
  };
  const issue = async (name, scope, age, sameSite) => {
    const expires = String(Date.now() + age * 1000);
    return setCookie(req, name, `${expires}.${await sign(`${scope}:${expires}`)}`, age, sameSite);
  };
  const checkRate = async (scope, maximum) => {
    const window = Math.floor(Date.now() / 60000);
    const key = await sign(`rate:${scope}:${req.headers.get('CF-Connecting-IP') || 'local'}:${window}`);
    const row = await db.prepare('INSERT INTO rate_limits(key,hits,expires_ms) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1 RETURNING hits').bind(key, (window + 1) * 60000).first();
    await db.prepare('DELETE FROM rate_limits WHERE expires_ms<?').bind(Date.now()).run();
    if (row.hits > maximum) error(429, 'Слишком много попыток. Попробуйте через минуту.');
  };
  const asset = async filename => {
    const assetResponse = await env.ASSETS.fetch(new Request(new URL('/' + filename, req.url), { method: 'GET' }));
    const headers = new Headers(assetResponse.headers);
    for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
    return new Response(assetResponse.body, { status: assetResponse.status, headers });
  };
  const redirect = (to, cookieValue) => response(303, '', { Location: to, ...(cookieValue ? { 'Set-Cookie': cookieValue } : {}) });
  if (req.method === 'GET' && path === '/health') {
    await db.prepare('SELECT id FROM sessions LIMIT 1').first();
    return response(200, { ok: true });
  }
  // Public assets expose the sign-in UI only; participant application assets are gated below.
  if (req.method === 'GET' && ['/admin', '/admin.js', '/styles.css', '/access.js'].includes(path)) return asset(path === '/admin' ? 'admin.html' : path.slice(1));
  if (req.method === 'POST' && path === '/api/admin/login') {
    await checkRate('admin-login', 10);
    const data = await body(req);
    if (typeof data.password !== 'string' || !equal(await sha(data.password), adminVersion)) error(401, 'Неверный пароль.');
    return response(200, { ok: true }, { 'Set-Cookie': await issue('research_admin', 'admin:' + adminVersion, 43200, 'Strict') });
  }
  if (path.startsWith('/api/admin/')) {
    if (!await authorize('research_admin', 'admin:' + adminVersion)) error(401, 'Войдите в панель исследователя.');
    if (path === '/api/admin/logout' && req.method === 'POST') return response(200, { ok: true }, { 'Set-Cookie': setCookie(req, 'research_admin', '', 0) });
    if (path === '/api/admin/invitation') {
      let invitation = await loadInvitation(db);
      if (req.method === 'POST') {
        const data = await body(req);
        if (!['disable', 'renew'].includes(data.action)) error(400, 'Неизвестное действие.');
        if (data.action === 'renew') invitation = { key: random(), enabled: true };
        else invitation.enabled = false;
        await db.batch([
          db.prepare("UPDATE settings SET value=? WHERE name='invitation_key'").bind(invitation.key),
          db.prepare("UPDATE settings SET value=? WHERE name='invitation_enabled'").bind(invitation.enabled ? '1' : '0')
        ]);
      } else if (req.method !== 'GET') error(405, 'Метод не поддерживается.');
      return response(200, { enabled: invitation.enabled, path: invitation.enabled ? '/invite/' + invitation.key : null });
    }
    if (req.method !== 'GET') error(405, 'Метод не поддерживается.');
    const detail = path.match(/^\/api\/admin\/sessions\/([a-f0-9-]{36})$/);
    if (detail) {
      const row = await db.prepare('SELECT * FROM sessions WHERE id=?').bind(detail[1]).first();
      if (!row) error(404, 'Прохождение не найдено.');
      const events = await eventsFor(db, row.id);
      return response(200, { ...summarize(row, events), events });
    }
    if (['/api/admin/sessions', '/api/admin/export.json', '/api/admin/export.csv'].includes(path)) {
      const sessions = await list(db);
      if (path.endsWith('.json')) return response(200, { exportedAt: new Date().toISOString(), sessions }, { 'Content-Disposition': 'attachment; filename="research.json"' });
      const summaries = sessions.map(({ events, ...s }) => s);
      if (path.endsWith('.csv')) return response(200, exportCsv(summaries), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="research.csv"' });
      return response(200, { sessions: summaries });
    }
    error(404, 'Страница не найдена.');
  }
  const invitation = await loadInvitation(db);
  const inviteScope = 'invite:' + invitation.key;
  const accessScope = 'participant:' + invitation.key + ':' + participantVersion;
  const invited = invitation.enabled && await authorize('research_invite', inviteScope);
  const participant = invitation.enabled && await authorize('research_access', accessScope);
  if (req.method === 'GET' && path.startsWith('/invite/')) {
    if (!invitation.enabled || !equal(path.slice('/invite/'.length), invitation.key)) error(404, 'Ссылка недействительна или исследование закрыто.');
    return redirect('/login', await issue('research_invite', inviteScope, 604800, 'Lax'));
  }
  if (path === '/api/access/login' && req.method === 'POST') {
    if (!invited) error(403, 'Откройте действующую ссылку исследователя.');
    await checkRate('participant-login', 10);
    const data = await body(req);
    if (typeof data.password !== 'string' || !equal(await sha(data.password), participantVersion)) error(401, 'Неверный пароль.');
    return response(200, { ok: true }, { 'Set-Cookie': await issue('research_access', accessScope, 604800, 'Lax') });
  }
  if (req.method === 'GET' && (path === '/login' || path === '/') && !participant) {
    if (invited) return path === '/login' ? asset('access.html') : redirect('/login');
    return response(403, '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Доступ по приглашению</title><link rel="stylesheet" href="/styles.css"></head><body><main class="finished"><h1>Доступ по приглашению</h1><p>Откройте ссылку, которую прислал исследователь. Для входа понадобится пароль участника.</p></main></body></html>', { 'Content-Type': 'text/html; charset=utf-8' });
  }
  if ((path === '/app.js' || path.startsWith('/api/sessions')) && !participant) error(403, 'Для доступа к исследованию войдите по ссылке и паролю.');
  if (participant && req.method === 'GET' && path === '/login') return redirect('/');
  if (participant && req.method === 'GET' && ['/', '/app.js'].includes(path)) return asset(path === '/' ? 'index.html' : 'app.js');
  if (path === '/api/sessions' && req.method === 'POST') {
    await checkRate('session', 30);
    const data = await body(req), id = crypto.randomUUID(), token = random(), now = new Date().toISOString();
    const viewport = { width: Math.min(10000, Math.max(0, Number(data.width) || 0)), height: Math.min(10000, Math.max(0, Number(data.height) || 0)) };
    await db.prepare('INSERT INTO sessions(id,token_hash,started_at,last_seen,viewport) VALUES(?,?,?,?,?)').bind(id, await sha(token), now, now, JSON.stringify(viewport)).run();
    return response(201, { id, token });
  }
  const batch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/events$/);
  if (batch && req.method === 'POST') {
    const data = await body(req);
    const row = await db.prepare('SELECT token_hash FROM sessions WHERE id=?').bind(batch[1]).first();
    const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') || data.token;
    if (!row || typeof token !== 'string' || !equal(row.token_hash, await sha(token))) error(401, 'Нет доступа к прохождению.');
    const clean = validateEvents(data.events), now = new Date().toISOString();
    const statements = clean.map(e => db.prepare('INSERT INTO events(session_id,seq,type,at_ms,received_at,data) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(batch[1], e.seq, e.type, e.atMs, now, JSON.stringify(e.data)));
    statements.push(db.prepare(`UPDATE sessions SET last_seen=?,status=CASE WHEN
      (SELECT COUNT(DISTINCT json_extract(data,'$.task')) FROM events WHERE session_id=? AND type='task_result')=2
      AND EXISTS(SELECT 1 FROM events WHERE session_id=? AND type='study_completed')
      THEN 'completed' ELSE 'in_progress' END WHERE id=?`).bind(now, batch[1], batch[1], batch[1]));
    // D1 batch executes all writes and the status update in one atomic transaction.
    await db.batch(statements);
    return response(200, { accepted: clean.map(e => e.seq) });
  }
  error(404, 'Страница не найдена.');
}

export default {
  async fetch(req, env) {
    try { return await route(req, env); }
    catch (e) {
      if (!e.status) console.error('Worker request failed:', e.message);
      return response(e.status || 503, { error: e.status ? e.message : 'Сервис временно недоступен. Попробуйте позже.' });
    }
  }
};
