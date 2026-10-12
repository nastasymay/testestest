import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fields = ['action', 'target', 'state', 'organization', 'product', 'tab', 'task', 'outcome', 'answer', 'durationMs', 'x', 'y', 'width', 'height', 'visibility', 'reason'];
const types = new Set(['study_started', 'task_started', 'click', 'state_view', 'task_result', 'study_completed', 'visibility', 'page_exit']);
const states = new Set(['products.mine', 'products.organization', 'organization.menu', 'diadoc.current', 'diadoc.future', 'diadoc.archive', 'extern.current', 'extern.future', 'extern.archive', 'tolk.current', 'tolk.future', 'tolk.archive', 'checkout.plans', 'checkout.invoice']);
const cookieName = 'research_admin';

export function createApp({ dataDir = process.env.DATA_DIR || resolve(root, '.data'), adminPassword = process.env.ADMIN_PASSWORD, secureCookies = process.env.NODE_ENV === 'production' } = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (!adminPassword) {
    if (secureCookies) throw new Error('Set ADMIN_PASSWORD before starting in production.');
    const path = resolve(dataDir, 'admin-password');
    if (!existsSync(path)) writeFileSync(path, randomBytes(24).toString('base64url'), { mode: 0o600 });
    adminPassword = readFileSync(path, 'utf8').trim();
  }
  if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
  const keyPath = resolve(dataDir, 'cookie-key');
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString('hex'), { mode: 0o600 });
  const cookieKey = readFileSync(keyPath, 'utf8').trim();
  const invitationPath = resolve(dataDir, 'invitation.json');
  let invitation = existsSync(invitationPath) ? JSON.parse(readFileSync(invitationPath, 'utf8')) : { key: randomBytes(32).toString('base64url'), enabled: true };
  const saveInvitation = () => writeFileSync(invitationPath, JSON.stringify(invitation), { mode: 0o600 });
  saveInvitation();
  const accessSignature = expires => createHmac('sha256', cookieKey).update(`participant:${invitation.key}:${expires}`).digest('hex');
  const authorizeParticipant = req => {
    const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('research_access='))?.slice('research_access='.length) || '';
    const [expires, signature] = raw.split('.');
    return invitation.enabled && Number(expires) > Date.now() && equal(signature, accessSignature(expires));
  };
  const db = new DatabaseSync(resolve(dataDir, 'research.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, started_at TEXT NOT NULL,
      last_seen TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'in_progress', viewport TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      session_id TEXT NOT NULL REFERENCES sessions(id), seq INTEGER NOT NULL,
      type TEXT NOT NULL, at_ms INTEGER NOT NULL, received_at TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY(session_id, seq)
    );`);
  const limits = new Map();
  const authorizeAdmin = req => {
    const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
    const [nonce, expires, signature] = raw.split('.');
    return nonce && Number(expires) > Date.now() && equal(signature, createHmac('sha256', cookieKey).update(`${nonce}.${expires}`).digest('hex'));
  };
  const checkRate = (req, scope, maximum) => {
    const now = Date.now();
    for (const [key, value] of limits) if (value.until < now) limits.delete(key);
    const key = `${scope}:${req.socket.remoteAddress}`;
    const current = limits.get(key) || { count: 0, until: now + 60000 };
    current.count++;
    limits.set(key, current);
    if (current.count > maximum) throw Object.assign(new Error('Слишком много запросов. Попробуйте через минуту.'), { status: 429 });
  };
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Требуется JSON.'), { status: 415 });
    let input = '';
    for await (const chunk of req) {
      input += chunk;
      if (Buffer.byteLength(input) > 100000) throw Object.assign(new Error('Запрос слишком большой.'), { status: 413 });
    }
    try { return JSON.parse(input); } catch { throw Object.assign(new Error('Некорректный JSON.'), { status: 400 }); }
  }
  const sessionEvents = id => db.prepare('SELECT seq, type, at_ms AS atMs, received_at AS receivedAt, data FROM events WHERE session_id=? ORDER BY seq').all(id).map(e => ({ ...e, data: JSON.parse(e.data) }));
  function summarize(row) {
    const events = sessionEvents(row.id);
    const tasks = [1, 2].map(task => {
      const start = events.find(e => e.type === 'task_started' && e.data.task === task);
      const result = events.find(e => e.type === 'task_result' && e.data.task === task);
      const relevant = events.find(e => e.type === 'state_view' && e.seq > (start?.seq ?? Infinity) && e.seq < (result?.seq ?? Infinity) && (task === 1 ? e.data.state === 'diadoc.current' : e.data.state === 'extern.current' && e.data.organization === 'romashka'));
      return { task, outcome: result?.data.outcome || 'unrun', answer: result?.data.answer || '', durationMs: result && start ? Math.max(0, result.atMs - start.atMs) : null, relevantScreenVisited: Boolean(relevant), timeToRelevantScreenMs: relevant && start ? Math.max(0, relevant.atMs - start.atMs) : null };
    });
    return { id: row.id, startedAt: row.started_at, lastSeen: row.last_seen, status: row.status, viewport: JSON.parse(row.viewport), clicks: events.filter(e => e.type === 'click').length, durationMs: events.at(-1)?.atMs ?? 0, tasks, path: events.filter(e => e.type === 'state_view').map(e => e.data.state), eventCount: events.length };
  }
  const list = () => db.prepare('SELECT id, started_at, last_seen, status, viewport FROM sessions ORDER BY started_at DESC').all().map(summarize);
  const insert = db.prepare('INSERT INTO events(session_id,seq,type,at_ms,received_at,data) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING');
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://local');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /\n', { 'Content-Type': 'text/plain; charset=utf-8' });
      if (req.method === 'GET' && path.startsWith('/invite/')) {
        if (!invitation.enabled || !equal(path.slice('/invite/'.length), invitation.key)) return send(res, 404, { error: 'Ссылка недействительна или исследование закрыто.' });
        const expires = String(Date.now() + 604800000);
        return send(res, 303, '', { Location: '/', 'Set-Cookie': `research_access=${expires}.${accessSignature(expires)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secureCookies ? '; Secure' : ''}` });
      }
      if ((path === '/' || path === '/app.js' || path.startsWith('/api/sessions')) && !authorizeParticipant(req)) {
        if (path === '/') return send(res, 403, '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Доступ по приглашению</title><link rel="stylesheet" href="/styles.css"></head><body><main class="finished"><h1>Доступ по приглашению</h1><p>Откройте специальную ссылку, которую прислал исследователь. Если ссылка больше не работает, исследование могло завершиться.</p></main></body></html>', { 'Content-Type': 'text/html; charset=utf-8' });
        return send(res, 403, { error: 'Доступ только по действующей ссылке исследователя.' });
      }
      if (req.method === 'POST' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'Недопустимый источник запроса.' });
      if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: db.prepare('SELECT 1 AS ok').get().ok === 1 });
      if (req.method === 'POST' && path === '/api/sessions') {
        checkRate(req, 'session', 30);
        const data = await body(req);
        const id = randomUUID(), token = randomBytes(32).toString('base64url'), now = new Date().toISOString();
        const viewport = { width: Math.min(10000, Math.max(0, Number(data.width) || 0)), height: Math.min(10000, Math.max(0, Number(data.height) || 0)) };
        db.prepare('INSERT INTO sessions(id,token_hash,started_at,last_seen,viewport) VALUES(?,?,?,?,?)').run(id, sha(token), now, now, JSON.stringify(viewport));
        return send(res, 201, { id, token });
      }
      const batch = path.match(/^\/api\/sessions\/([a-f0-9-]{36})\/events$/);
      if (batch && req.method === 'POST') {
        checkRate(req, 'events', 240);
        const data = await body(req);
        const row = db.prepare('SELECT * FROM sessions WHERE id=?').get(batch[1]);
        const token = req.headers.authorization?.replace(/^Bearer /, '') || data.token;
        if (!row || !token || !equal(row.token_hash, sha(token))) return send(res, 401, { error: 'Нет доступа к прохождению.' });
        if (!Array.isArray(data.events) || !data.events.length || data.events.length > 100) return send(res, 400, { error: 'Некорректный пакет событий.' });
        const clean = data.events.map(event => {
          if (!Number.isSafeInteger(event.seq) || event.seq < 1 || event.seq > 100000 || !types.has(event.type) || !Number.isSafeInteger(event.atMs) || event.atMs < 0 || event.atMs > 604800000 || !event.data || typeof event.data !== 'object') throw Object.assign(new Error('Некорректное событие.'), { status: 400 });
          const safe = {};
          for (const field of fields) {
            const v = event.data[field];
            if (typeof v === 'string') safe[field] = v.slice(0, field === 'answer' ? 2000 : 150);
            if (typeof v === 'number' && Number.isFinite(v)) safe[field] = v;
          }
          if (event.type === 'state_view' && !states.has(safe.state)) throw Object.assign(new Error('Неизвестный экран.'), { status: 400 });
          if (['task_started', 'task_result'].includes(event.type) && ![1, 2].includes(safe.task)) throw Object.assign(new Error('Неизвестное задание.'), { status: 400 });
          if (event.type === 'task_result' && !['completed', 'gave_up'].includes(safe.outcome)) throw Object.assign(new Error('Некорректный результат.'), { status: 400 });
          return { ...event, data: safe };
        });
        const now = new Date().toISOString();
        db.exec('BEGIN');
        try {
          for (const event of clean) insert.run(row.id, event.seq, event.type, event.atMs, now, JSON.stringify(event.data));
          const completed = db.prepare("SELECT COUNT(DISTINCT json_extract(data,'$.task')) AS n FROM events WHERE session_id=? AND type='task_result'").get(row.id).n === 2 && db.prepare("SELECT 1 FROM events WHERE session_id=? AND type='study_completed'").get(row.id);
          db.prepare('UPDATE sessions SET last_seen=?, status=? WHERE id=?').run(now, completed ? 'completed' : 'in_progress', row.id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return send(res, 200, { accepted: clean.map(e => e.seq) });
      }
      if (path === '/api/admin/login' && req.method === 'POST') {
        checkRate(req, 'login', 10);
        const data = await body(req);
        if (typeof data.password !== 'string' || !equal(sha(data.password), sha(adminPassword))) return send(res, 401, { error: 'Неверный пароль.' });
        const ticket = `${randomBytes(16).toString('hex')}.${Date.now() + 43200000}`;
        const signature = createHmac('sha256', cookieKey).update(ticket).digest('hex');
        return send(res, 200, { ok: true }, { 'Set-Cookie': `${cookieName}=${ticket}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookies ? '; Secure' : ''}` });
      }
      if (path.startsWith('/api/admin/')) {
        if (!authorizeAdmin(req)) return send(res, 401, { error: 'Войдите в панель исследователя.' });
        if (path === '/api/admin/invitation' && req.method === 'GET') return send(res, 200, { enabled: invitation.enabled, path: invitation.enabled ? '/invite/' + invitation.key : null });
        if (path === '/api/admin/invitation' && req.method === 'POST') {
          const data = await body(req);
          if (!['disable', 'renew'].includes(data.action)) return send(res, 400, { error: 'Неизвестное действие.' });
          const previous = invitation;
          invitation = data.action === 'disable' ? { ...invitation, enabled: false } : { key: randomBytes(32).toString('base64url'), enabled: true };
          try { saveInvitation(); } catch (error) { invitation = previous; throw error; }
          return send(res, 200, { enabled: invitation.enabled, path: invitation.enabled ? '/invite/' + invitation.key : null });
        }
        if (path === '/api/admin/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookies ? '; Secure' : ''}` });
        if (req.method !== 'GET') return send(res, 405, { error: 'Метод не поддерживается.' });
        if (path === '/api/admin/sessions') return send(res, 200, { sessions: list() });
        const detail = path.match(/^\/api\/admin\/sessions\/([a-f0-9-]{36})$/);
        if (detail) {
          const row = db.prepare('SELECT * FROM sessions WHERE id=?').get(detail[1]);
          return row ? send(res, 200, { ...summarize(row), events: sessionEvents(row.id) }) : send(res, 404, { error: 'Прохождение не найдено.' });
        }
        if (path === '/api/admin/export.json') return send(res, 200, { exportedAt: new Date().toISOString(), sessions: list().map(s => ({ ...s, events: sessionEvents(s.id) })) }, { 'Content-Disposition': 'attachment; filename="research.json"' });
        if (path === '/api/admin/export.csv') {
          const quote = value => {
            let text = String(value ?? '');
            if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          };
          const rows = [['session', 'started_at', 'status', 'clicks', 'duration_ms', 'task', 'outcome', 'task_duration_ms', 'relevant_screen_visited', 'time_to_relevant_screen_ms', 'answer']];
          for (const s of list()) for (const t of s.tasks) rows.push([s.id, s.startedAt, s.status, s.clicks, s.durationMs, t.task, t.outcome, t.durationMs, t.relevantScreenVisited, t.timeToRelevantScreenMs, t.answer]);
          return send(res, 200, '\ufeff' + rows.map(r => r.map(quote).join(',')).join('\r\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="research.csv"' });
        }
      }
      const staticFiles = { '/': ['index.html', 'text/html'], '/admin': ['admin.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/admin.js': ['admin.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
      if (req.method === 'GET' && staticFiles[path]) {
        const [file, mime] = staticFiles[path];
        return send(res, 200, readFileSync(resolve(root, 'public', file), 'utf8'), { 'Content-Type': mime + '; charset=utf-8' });
      }
      send(res, 404, { error: 'Страница не найдена.' });
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.message);
      if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Ошибка сервера. Попробуйте позже.' });
      else res.end();
    }
  });
  return { server, close: () => new Promise(done => server.close(() => { db.close(); done(); })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.server.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => {
    console.log(`Research prototype listening on port ${app.server.address().port}.`);
    if (!process.env.ADMIN_PASSWORD) console.log('Local admin password: .data/admin-password (never publish this file).');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
