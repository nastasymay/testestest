const root = document.querySelector('#admin');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${name === 'close' ? '<path d="m5 5 14 14M19 5 5 19"/>' : name === 'refresh' ? '<path d="M20 5v6h-6M20 11a9 9 0 1 0 0 6"/>' : name === 'arrow' ? '<path d="M3 12h18m-6-6 6 6-6 6"/>' : '<rect x="3" y="8" width="18" height="13" rx="3"/><path d="M5 5h14M7 2h10"/>'}</svg>`;
const status = { completed: 'Выполнено', gave_up: 'Не получилось', unrun: 'Не завершено', in_progress: 'В процессе / прервано' };
const screenNames = { 'products.mine': 'Продукты · Только мои', 'products.organization': 'Продукты · Выбранная организация', 'organization.menu': 'Список организаций', 'diadoc.current': 'Диадок · Действующие тарифы', 'diadoc.future': 'Диадок · Будущие тарифы', 'diadoc.archive': 'Диадок · Архив', 'extern.current': 'Экстерн · Действующие тарифы', 'extern.future': 'Экстерн · Будущие тарифы', 'extern.archive': 'Экстерн · Архив', 'tolk.current': 'Толк · Действующие тарифы', 'tolk.future': 'Толк · Будущие тарифы', 'tolk.archive': 'Толк · Архив', 'checkout.plans': 'Продление · Выбор тарифа', 'checkout.invoice': 'Просмотр счета' };
let sessions = [], authenticated = false, opened = null, refreshTimer;
const seconds = n => n === null || n === undefined ? '—' : `${Math.floor(n / 60000)}:${String(Math.floor(n / 1000) % 60).padStart(2, '0')}`;
const date = s => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(s));
const pill = (value, label) => `<span class="status-pill ${value}">${label || status[value] || esc(value)}</span>`;
function toast(text) { const t = document.querySelector('#toast'); t.textContent = text; t.classList.add('visible'); clearTimeout(t.timer); t.timer = setTimeout(() => t.classList.remove('visible'), 4000); }
async function request(path, data) {
  const res = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await res.json();
  if (!res.ok) throw Object.assign(new Error(result.error || 'Ошибка загрузки.'), { status: res.status });
  return result;
}
function login() {
  authenticated = false; opened = null; clearTimeout(refreshTimer);
  root.innerHTML = `<main class="admin-login"><div class="research-logo">${icon('products')}<span>Панель исследователя</span></div><h1>Результаты исследования</h1><p>Войдите, чтобы посмотреть прохождения и выгрузить данные участников.</p><form id="login-form"><label for="password">Пароль исследователя</label><input id="password" type="password" autocomplete="current-password" required><button class="primary" type="submit">Войти ${icon('arrow')}</button><div class="login-error" role="alert"></div></form></main>`;
  document.querySelector('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const button = e.target.querySelector('button'); button.disabled = true;
    try { await request('/api/admin/login', { password: document.querySelector('#password').value }); await refresh(); }
    catch (error) { document.querySelector('.login-error').textContent = error.message; button.disabled = false; }
  });
}
function rows() {
  if (!sessions.length) return `<div class="results-empty">${icon('products')}<h3>Первое прохождение — впереди</h3><p>Скопируйте ссылку на исследование и отправьте участнику. Результаты появятся здесь автоматически.</p></div>`;
  return `<div class="table-scroll"><table><thead><tr><th>Участник</th><th>Начало</th><th>Статус</th><th>Задание 1</th><th>Задание 2</th><th>Клики</th><th>Время</th><th></th></tr></thead><tbody>${sessions.map(s => `<tr><td><span class="session-id">${s.id.slice(0, 8)}</span><small>${s.viewport.width} × ${s.viewport.height}</small></td><td>${date(s.startedAt)}</td><td>${pill(s.status, s.status === 'completed' ? 'Завершено' : undefined)}</td>${s.tasks.map(t => `<td>${pill(t.outcome)}<small>${seconds(t.durationMs)}${t.relevantScreenVisited ? ' · экран открыт' : ''}</small></td>`).join('')}<td>${s.clicks}</td><td>${seconds(s.durationMs)}</td><td><button data-action="detail" data-id="${s.id}">Путь участника ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>`;
}
function stats() {
  const completed = sessions.filter(s => s.status === 'completed');
  const durations = completed.map(s => s.durationMs).sort((a, b) => a - b);
  const median = durations.length ? (durations[Math.floor((durations.length - 1) / 2)] + durations[Math.ceil((durations.length - 1) / 2)]) / 2 : null;
  return [['Прохождений', sessions.length, 'Анонимные сессии'], ['Исследование завершено', completed.length, 'Оба задания отмечены'], ['Доля завершений', sessions.length ? Math.round(completed.length / sessions.length * 100) + '%' : '—', 'Среди всех прохождений'], ['Медианное время', seconds(median), 'Завершенные исследования']].map(([label, value, note]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('');
}
function dashboard() {
  root.innerHTML = `<main class="admin-layout"><header class="admin-header"><a class="research-logo" href="/admin">${icon('products')}<span>Исследование кабинета клиента</span></a><div><span class="pill-neutral">Панель исследователя</span><button class="text-button" data-action="logout">Выйти</button></div></header><div class="admin-intro"><div><span class="eyebrow">НЕМОДЕРИРУЕМОЕ ИССЛЕДОВАНИЕ</span><h1>Прохождения и результаты</h1><p>Два задания · Тарифы Диадока и Экстерна</p></div><button class="primary" data-action="copy-link">Скопировать ссылку участника ${icon('arrow')}</button></div><div class="results-toolbar"><span id="invitation-status">Доступ участникам только по секретной ссылке</span><div><button data-action="disable-invitation">Отключить ссылку</button><button data-action="renew-invitation">Создать новую ссылку</button></div></div><div id="admin-error"></div><section class="admin-stats" id="stats">${stats()}</section><section class="results-card"><div class="results-toolbar"><h2>Все прохождения</h2><div><a class="export-link" href="/api/admin/export.csv" download>Скачать CSV</a><a class="export-link" href="/api/admin/export.json" download>JSON</a><button data-action="refresh">${icon('refresh')} Обновить</button></div></div><div id="results">${rows()}</div></section><p class="admin-footnote">«Выполнено» — участник сам отметил завершение задания. «Экран открыт» — нужная панель была посещена в ходе этого задания; это не проверка правильности ответа. Время считается от начала задания, включая паузы и время в других вкладках. Незавершенная сессия остается в списке. Отображаемое время начала соответствует часовому поясу вашего браузера.</p><p class="admin-update" id="admin-update">Обновлено ${new Date().toLocaleTimeString('ru-RU')} · обновление каждые 10 секунд</p></main>`;
}
async function refresh() {
  clearTimeout(refreshTimer);
  try {
    const result = await request('/api/admin/sessions');
    sessions = result.sessions;
    if (!authenticated) { authenticated = true; dashboard(); }
    else {
      document.querySelector('#stats').innerHTML = stats();
      document.querySelector('#results').innerHTML = rows();
      document.querySelector('#admin-update').textContent = `Обновлено ${new Date().toLocaleTimeString('ru-RU')} · обновление каждые 10 секунд`;
      document.querySelector('#admin-error').innerHTML = '';
    }
  } catch (error) {
    if (error.status === 401) return login();
    if (!authenticated) { login(); document.querySelector('.login-error').textContent = error.message; }
    else document.querySelector('#admin-error').innerHTML = `<p class="admin-error">Не удалось обновить результаты. Показываем последние загруженные данные.</p>`;
  }
  if (authenticated) refreshTimer = setTimeout(refresh, 10000);
}
function describe(e) {
  const d = e.data;
  if (e.type === 'state_view') return screenNames[d.state] || d.state;
  if (e.type === 'click') return `Клик: ${d.target || d.action}`;
  if (e.type === 'study_started') return 'Исследование начато';
  if (e.type === 'task_started') return `Начато задание ${d.task}`;
  if (e.type === 'task_result') return `Задание ${d.task}: ${status[d.outcome]}`;
  if (e.type === 'study_completed') return 'Исследование завершено';
  if (e.type === 'visibility') return d.visibility === 'hidden' ? 'Участник переключился в другую вкладку' : 'Участник вернулся во вкладку';
  return 'Участник закрыл или перезагрузил страницу';
}
async function detail(id) {
  try {
    const s = await request(`/api/admin/sessions/${id}`);
    opened = id;
    document.querySelector('#detail')?.remove();
    const container = document.createElement('div'); container.id = 'detail';
    container.innerHTML = `<div class="detail-backdrop" data-action="close-detail"></div><aside class="detail-panel" role="dialog" aria-modal="true" aria-label="Путь участника"><header class="detail-heading"><div><h2>Участник ${s.id.slice(0, 8)}</h2><p>${date(s.startedAt)} · ${s.clicks} кликов · ${seconds(s.durationMs)}</p></div><button class="icon-button" data-action="close-detail" aria-label="Закрыть путь участника">${icon('close')}</button></header>${s.tasks.map(t => `<section class="task-result-card"><header><strong>Задание ${t.task}</strong>${pill(t.outcome)}</header><div class="metrics"><span>Время: ${seconds(t.durationMs)}</span><span>Нужный экран: ${t.relevantScreenVisited ? 'открыт за ' + seconds(t.timeToRelevantScreenMs) : 'не посещен'}</span></div><p class="answer">${t.answer ? esc(t.answer) : 'Ответ не оставлен'}</p></section>`).join('')}<h3 class="timeline-title">Путь по прототипу</h3><ol class="timeline">${s.events.map(e => `<li><time>${seconds(e.atMs)}</time><div>${esc(describe(e))}${e.data.organization ? `<p>Организация: ${esc(e.data.organization)}${e.data.state ? ' · ' + esc(screenNames[e.data.state] || e.data.state) : ''}</p>` : ''}${e.type === 'click' && e.data.x !== undefined ? `<p>Координаты: ${e.data.x}, ${e.data.y} · Экран ${e.data.width} × ${e.data.height}</p>` : ''}</div></li>`).join('')}</ol></aside>`;
    document.body.append(container);
    container.querySelector('button').focus();
  } catch (error) { if (error.status === 401) login(); else toast(error.message); }
}
document.addEventListener('click', async e => {
  const button = e.target.closest('[data-action]');
  if (!button) return;
  switch (button.dataset.action) {
    case 'refresh': await refresh(); break;
    case 'disable-invitation': case 'renew-invitation': {
      const renew = button.dataset.action === 'renew-invitation';
      if (!confirm(renew ? 'Создать новую ссылку? Прежняя ссылка и доступ уже открывших ее участников перестанут работать.' : 'Закрыть исследование? Участники не смогут продолжить прохождение. Результаты сохранятся.')) break;
      try {
        await request('/api/admin/invitation', { action: renew ? 'renew' : 'disable' });
        document.querySelector('#invitation-status').textContent = renew ? 'Новая ссылка создана. Скопируйте ее для участников.' : 'Доступ участникам отключен. Результаты сохранены.';
        toast(renew ? 'Новая ссылка создана; прежняя больше не действует.' : 'Ссылка отключена.');
      } catch (error) { toast(error.message); }
      break;
    }
    case 'detail': await detail(button.dataset.id); break;
    case 'close-detail': document.querySelector('#detail')?.remove(); opened = null; break;
    case 'logout': await request('/api/admin/logout', {}); document.querySelector('#detail')?.remove(); login(); break;
    case 'copy-link': {
      if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
        toast('Сайт запущен локально. Ссылка для участников появится после размещения на хостинге.');
        break;
      }
      const invitation = await request('/api/admin/invitation');
      if (!invitation.enabled) { toast('Ссылка отключена. Создайте новую ссылку, чтобы продолжить исследование.'); break; }
      const link = location.origin + invitation.path;
      try { await navigator.clipboard.writeText(link); toast('Ссылка участника скопирована.'); }
      catch { toast('Ссылка участника: ' + link); }
      break;
    }
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && opened) { document.querySelector('#detail')?.remove(); opened = null; }
  if (e.key === 'Tab' && opened) {
    const nodes = [...document.querySelectorAll('.detail-panel button, .detail-panel a')];
    if (!nodes.length) return;
    if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0].focus(); }
  }
});
refresh();
