const app = document.querySelector('#app');
const TASKS = [
  'Представьте, что вам нужно посмотреть подробную информацию о подключенном Диадоке: какой тариф используется и до какого числа он действует. Найдите эту информацию.',
  'У вас несколько организаций. Узнайте, какой тариф Экстерна подключен у ООО «Ромашка».'
];
const ORGS = [
  { id: 'tapochki', name: 'Тапочки', number: '5668585959–11157671' },
  { id: 'orehi', name: 'Орехи и белки', number: '89768585959–45857679' },
  { id: 'romashka', name: 'Ромашка', number: '9007685859–67857699' },
  { id: 'medveri', name: 'Медвери.ру', number: '98768585959–59857667', restricted: true },
  { id: 'shrek', name: 'Шрек шрек шрек', number: '78768585959–59857670', restricted: true }
];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icons = {
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  settings: '<path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  shield: '<path d="m12 3 9 4c0 8-3 11-9 14C6 18 3 15 3 7Z"/><path d="m8 11 3 3 5-6"/>',
  award: '<circle cx="12" cy="9" r="6"/><circle cx="12" cy="9" r="3"/><path d="m8 14-3 7 7-3 7 3-3-7"/>',
  products: '<rect x="3" y="8" width="18" height="13" rx="3"/><path d="M5 5h14M7 2h10"/>',
  briefcase: '<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V3h8v4M3 12q9 6 18 0"/>',
  file: '<path d="M6 2h8l5 5v15H6ZM14 2v6h5M9 12h7M9 16h5"/>',
  wrench: '<path d="M21 3a6 6 0 0 1-7 8L5 21l-3-3 10-9a6 6 0 0 1 8-7l-4 4 2 2Z"/>',
  message: '<rect x="3" y="4" width="16" height="17" rx="4"/><circle cx="19" cy="4" r="3"/>',
  heart: '<path d="M12 21 3 12C-3 3 7-1 12 6c5-7 15-3 9 6Z"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M3 22v-3a9 9 0 0 1 18 0v3"/>',
  chevron: '<path d="m5 9 7 7 7-7"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  arrow: '<path d="M3 12h18m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh: '<path d="M20 5v6h-6M20 11a9 9 0 1 0 0 6"/>',
  video: '<rect x="3" y="5" width="13" height="14" rx="3"/><path d="m16 9 5-3v12l-5-3"/>',
  chart: '<path d="M5 20v-7h3v7m3 0V9h3v11m3 0V4h3v16"/>',
  laptop: '<rect x="4" y="3" width="16" height="13" rx="2"/><path d="m4 16-3 5h22l-3-5"/>',
  ruble: '<path d="M8 21V3h5a5 5 0 0 1 0 10H5M5 17h10"/>',
};
function icon(name, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`; }
function badge(product) { return `<span class="product-icon ${product}">${icon({ extern: 'check', diadoc: 'file', tolk: 'video', expert: 'chart' }[product])}</span>`; }
function organization() { return ORGS.find(o => o.id === ui.org); }
function orgName() { return ui.org === 'mine' ? 'Только мои' : `ООО «${organization()?.name || ''}»`; }
const storageKey = 'kontur-study-v1';
let stored;
try { stored = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* New session. */ }
let study = stored?.id && stored?.token ? stored : null;
let ui = study?.ui || { stage: 'welcome', task: 1, org: 'mine', menu: false, tooltip: true, panel: null, tab: 'current', checkout: null, selectedPlan: 0, period: 12, payment: 'Счет', hiddenPromos: [], minimizedTask: false, answerModal: null };
let working = false, syncing = false, synced = true, retryTimer;
function save() {
  if (!study) return;
  study.ui = ui;
  try { sessionStorage.setItem(storageKey, JSON.stringify(study)); } catch { toast('Браузер не сохраняет локальную копию. Не закрывайте вкладку до завершения.'); }
}
function toast(message) {
  const t = document.querySelector('#toast');
  t.textContent = message;
  t.classList.add('visible');
  clearTimeout(t.timeout);
  t.timeout = setTimeout(() => t.classList.remove('visible'), 4500);
}
async function api(path, data) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Не удалось сохранить данные.');
  return result;
}
function track(type, data = {}) {
  if (!study || ui.stage === 'welcome') return;
  study.seq++;
  study.queue.push({ seq: study.seq, type, atMs: Math.max(0, Date.now() - study.startedMs), data });
  save();
  synced = false;
  updateSync();
  flush();
}
function updateSync() {
  const el = document.querySelector('#sync-status');
  if (!el) return;
  const pending = Boolean(study?.queue.length);
  el.textContent = pending ? (navigator.onLine ? 'Сохраняем…' : 'Нет связи · данные в этой вкладке') : 'Данные сохранены';
  el.className = 'sync-status ' + (pending ? 'pending' : 'saved');
  if (!synced && pending && !syncing) el.textContent = 'Нет связи с сервером · повторяем сохранение';
}
async function flush() {
  if (!study || syncing || !study.queue.length) return;
  clearTimeout(retryTimer);
  syncing = true;
  updateSync();
  let success = false;
  try {
    const batch = study.queue.slice(0, 100);
    const result = await api(`/api/sessions/${study.id}/events`, { token: study.token, events: batch });
    study.queue = study.queue.filter(e => !result.accepted.includes(e.seq));
    synced = !study.queue.length;
    success = true;
    save();
  } catch { synced = false; }
  syncing = false;
  updateSync();
  if (study.queue.length) retryTimer = setTimeout(flush, success ? 50 : 4000);
}
function state() {
  if (ui.checkout) return `checkout.${ui.checkout}`;
  if (ui.panel) return `${ui.panel}.${ui.tab}`;
  if (ui.menu) return 'organization.menu';
  return ui.org === 'mine' ? 'products.mine' : 'products.organization';
}
function view() { track('state_view', { state: state(), organization: ui.org, product: ui.panel || '', tab: ui.tab, task: ui.task }); }
function render() {
  if (ui.stage === 'welcome') renderWelcome();
  else if (ui.stage === 'done') renderDone();
  else renderPrototype();
  updateSync();
}
function renderWelcome() {
  app.innerHTML = `<main class="welcome"><header class="welcome-header"><a class="research-logo" href="/">${icon('products')}<span>Исследование интерфейса</span></a><span class="pill-neutral">≈ 5 минут</span></header>
    <div class="welcome-grid"><section><span class="eyebrow">КАБИНЕТ КЛИЕНТА</span><h1>Помогите сделать<br>кабинет удобнее</h1><p class="welcome-lead">Два коротких задания в интерактивном прототипе. Действуйте так, как вы бы действовали в настоящем кабинете.</p>
    <div class="welcome-steps"><div><span>01</span><p>Прочитайте задание и найдите нужную информацию.</p></div><div><span>02</span><p>Нажмите «Задание выполнено» или «Не получилось».</p></div></div>
    <p class="privacy-note">Мы сохраним ваши клики, переходы между экранами, время и результаты заданий. Имя, почта и запись экрана не собираются. В прототипе используются демонстрационные данные; реальные покупки не совершаются.</p>
    <label class="consent"><input id="consent" type="checkbox"> Я согласен(на) на сбор данных прохождения для исследования</label>
    <button class="primary start-button" data-action="start" disabled>Начать исследование ${icon('arrow')}</button><p class="quiet welcome-foot">Здесь проверяют интерфейс — правильность ваших действий не оценивается.</p></section>
    <div class="welcome-art" aria-hidden="true"><div class="art-window"><div class="art-title"><i></i><i></i><i></i><span>Кабинет клиента</span></div><div class="art-body"><div class="art-nav"><strong>Контур</strong><div></div><div></div><div class="selected"></div><div></div></div><div class="art-content"><strong>Продукты</strong><div class="art-product">${badge('extern')}<div><b>Экстерн</b><p>Управляйте вашими тарифами</p></div></div><div class="art-product">${badge('diadoc')}<div><b>Диадок</b><p>Все организации в одном месте</p></div></div><div class="art-lines"><i></i><i></i><i></i></div></div></div></div><div class="art-note">${icon('check')} Ваш опыт поможет нам</div><span class="art-orbit orbit-one"></span><span class="art-orbit orbit-two"></span></div></div>
    <footer class="welcome-footer"><span>Немодерируемое исследование</span><span>2 задания · Без регистрации</span></footer></main>`;
  document.querySelector('#consent').addEventListener('change', e => document.querySelector('[data-action="start"]').disabled = !e.target.checked);
}
function taskBar() {
  return `<header class="task-bar ${ui.minimizedTask ? 'minimized' : ''}"><div class="task-number">${ui.task}<span>/ 2</span></div><div class="task-copy"><span class="task-label">Задание ${ui.task} из 2</span><p>${TASKS[ui.task - 1]}</p></div><div class="task-actions"><button class="primary small" data-action="task-complete">Задание выполнено</button><button class="text-button" data-action="task-giveup">Не получилось</button></div><button class="icon-button" data-action="task-toggle" aria-label="${ui.minimizedTask ? 'Показать задание' : 'Свернуть задание'}">${icon('chevron', ui.minimizedTask ? '' : 'rotate')}</button></header>`;
}
function sidebar() {
  const links = [['bell', 'Уведомления'], ['settings', 'Личные данные'], ['shield', 'Безопасность'], ['award', 'Сертификаты'], ['products', 'Продукты'], ['briefcase', 'Организации'], ['file', 'Документы'], ['wrench', 'Внедрение'], ['message', 'Коммуникации'], ['heart', 'Рекомендуйте Контур']];
  return `<nav class="sidebar" aria-label="Разделы кабинета"><div class="brand"><strong>Контур</strong><span>Кабинет клиента</span></div><div class="nav-items">${links.map(([i, label], index) => `<button class="nav-item ${label === 'Продукты' ? 'active' : ''} ${index === 0 ? 'first' : ''}" data-action="nav" data-label="${label}">${icon(i)}<span>${label}</span></button>`).join('')}</div><div class="profile"><span class="avatar">ТС</span><span>Татьяна Смирнова</span></div></nav>`;
}
function productRow(id, name, subtitle) { return `<button class="product-row" data-action="product" data-product="${id}">${badge(id)}<div><h2>${name}</h2><div class="product-description">${subtitle}</div></div></button>`; }
function products() {
  const selected = ui.org !== 'mine';
  return `<section class="products-card"><div class="products-heading"><h1>Продукты</h1><div class="organization-control"><button class="organization-button ${ui.menu ? 'opened' : ''}" data-action="organization-menu" aria-haspopup="true" aria-expanded="${ui.menu}" title="${esc(orgName())}${selected ? ', ' + esc(organization()?.number) : ''}">${icon(selected ? 'briefcase' : 'user')}<span>${esc(orgName())}</span>${icon('chevron', ui.menu ? 'rotate' : '')}</button>${ui.menu ? organizationMenu() : ''}${ui.tooltip && !ui.menu ? `<div class="onboarding-tooltip"><p>Теперь вы можете управлять продуктами любой вашей организации — выберите ее из списка</p><button data-action="dismiss-tooltip">Отлично</button></div>` : ''}</div></div>
    <div class="product-list">${productRow('extern', 'Экстерн', `<span>Тариф оптимальный</span> <span class="warning">Закончится через 14 дней</span>${!selected ? '<p class="muted">ООО «Новосибирское предприятие»</p>' : ''}`)}
    ${productRow('diadoc', 'Диадок', selected ? '<span>3 тарифа</span> <span class="warning">Заканчиваются 2 тарифа</span>' : '<span>4 тарифа · 2 организации</span> <span class="warning">Заканчивается 1 тариф</span>')}
    ${selected ? productRow('tolk', 'Толк', '<span>Профи для одной виртуальной комнаты, 12 мес</span><p class="muted">до 10 января 2027</p>') : ''}</div>
    <section class="recommendations"><div class="recommendations-heading"><h2>Рекомендации для вас</h2><div><button class="icon-button" data-action="recommendations-prev" aria-label="Предыдущие рекомендации">${icon('arrow', 'flip')}</button><button class="icon-button" data-action="recommendations-next" aria-label="Следующие рекомендации">${icon('arrow')}</button></div></div><div class="recommendation-grid">${[0, 1, 2].map(i => `<article>${badge('expert')}<h3>Эксперт — проверка сделок</h3><p>Автоматический сбор сведений об объекте и участниках сделки, так же подскажет о потенциальных рисках на всех этапах</p><button data-action="recommendation" data-label="Рекомендация ${i + 1}">Подключить</button></article>`).join('')}</div></section></section>`;
}
function organizationMenu() {
  return `<div class="organization-menu"><button class="org-option own" data-action="select-org" data-org="mine">Только мои</button>${ORGS.map((o, i) => `${i === 3 ? '<p class="certificate-note">Потребуется сертификат руководителя</p>' : ''}<button class="org-option ${ui.org === o.id ? 'selected' : ''}" data-action="select-org" data-org="${o.id}"><span>ООО «${o.name}»</span><span class="muted">${o.number}</span></button>`).join('')}<button class="org-option org-add" data-action="add-organization">＋ Добавить организацию</button></div>`;
}
function promos() {
  const items = [['Установите приложение диагностики ПК', 'Оно будет поддерживать ваш компьютер готовым к работе', 'laptop'], ['Факторинг для бизнеса по ставке от 0,05% в день', 'Специальные условия для поставщиков', 'ruble'], ['Реферальная программа', 'Рекомендуйте Контур и получайте вознаграждение', 'heart']];
  return `<aside class="promos">${items.map(([title, desc, i], index) => ui.hiddenPromos.includes(index) ? '' : `<article class="promo"><button class="icon-button promo-close" data-action="hide-promo" data-index="${index}" aria-label="Скрыть: ${title}">${icon('close')}</button><h3>${title}</h3><p>${desc}</p>${icon(i, 'promo-icon')}</article>`).join('')}</aside>`;
}
function tariff(name, date, expiry, renew = false, extra = '') { return `<div class="tariff"><div><h3>${name} ${extra ? `<span class="muted">${extra}</span>` : ''}</h3><p>${expiry ? `<span class="expiry">${expiry}</span> · ` : ''}${date}</p></div>${renew ? `<button class="renew" data-action="renew">${icon('refresh')} Продлить</button>` : ''}</div>`; }
function panel() {
  if (!ui.panel) return '';
  const name = { extern: 'Экстерн', diadoc: 'Диадок', tolk: 'Толк' }[ui.panel];
  let content;
  if (ui.tab !== 'current') content = `<div class="empty-tariffs">${icon('file')}<h3>${ui.tab === 'future' ? 'Будущих тарифов пока нет' : 'В архиве пока нет тарифов'}</h3><p>Здесь появятся ${ui.tab === 'future' ? 'тарифы с будущей датой начала' : 'завершенные тарифы'}.</p></div>`;
  else if (ui.panel === 'diadoc' && ui.org === 'mine') content = `<section class="tariff-group"><h3 class="tariff-org">${icon('briefcase')} ООО «Орехи и белки» · 6612345678 – 12347890567</h3>${tariff('Общий плюс, 1+9 организаций на обслуживании, на 24 мес.', 'до 10 ноября 2026', 'Закончится через 12 дней', true)}${tariff('Общий плюс, 1+9 организаций на обслуживании, на 12 мес.', 'до 10 января 2027', '', false, '2 шт')}</section><section class="tariff-group"><h3 class="tariff-org">${icon('briefcase')} ООО «Новосибирское предприятие» · 9912345678 – 23457890567</h3>${tariff('Отправка в ФНС', 'до 10 января 2027')}${tariff('Маршруты согласования, 1 год, 1 цепочка — основной тарифный план', 'до 10 января 2027', '', false, '2 шт')}</section>`;
  else if (ui.panel === 'extern') content = tariff(ui.org === 'romashka' ? 'Тариф оптимальный плюс' : 'Тариф оптимальный', 'до 10 ноября 2026', 'Закончится через 14 дней', true);
  else if (ui.panel === 'tolk') content = tariff('Профи для одной виртуальной комнаты, 12 мес.', 'до 10 января 2027');
  else content = `${tariff('Общий плюс, 1+9 организаций на обслуживании, на 12 мес.', 'до 10 ноября 2026', 'Закончится через 14 дней', true)}${tariff('Отправка в ФНС', 'до 10 ноября 2026', 'Закончится через 14 дней', true)}${tariff('Маршруты согласования, 1 год, 1 цепочка', 'до 10 января 2027')}`;
  return `<div class="drawer-overlay" data-action="close-panel"></div><aside class="product-drawer" role="dialog" aria-modal="true" aria-label="${name}: подробная информация"><button class="icon-button drawer-close" data-action="close-panel" aria-label="Закрыть подробную информацию">${icon('close')}</button><header class="drawer-heading">${badge(ui.panel)}<div><h2>${name}</h2>${ui.org !== 'mine' || ui.panel === 'extern' ? `<h3>${ui.org === 'mine' ? 'ООО «Новосибирское предприятие»' : esc(orgName())}</h3><p class="muted">ИНН ${ui.org === 'mine' ? '9912345678' : esc(organization()?.number.split('–')[0])}　КПП ${ui.org === 'mine' ? '23457890567' : esc(organization()?.number.split('–')[1])}</p>` : ''}</div></header>
    ${ui.panel === 'extern' && ui.org === 'romashka' ? '<div class="invoice-callout"><span>Заканчивается срок действия услуг</span><button class="yellow" data-action="invoice">Смотреть счет</button></div>' : ''}
    <div class="tariff-tabs" role="tablist" aria-label="Тарифы">${[['current', 'Действующие тарифы'], ['future', 'Будущие'], ['archive', 'Архив']].map(([id, label]) => `<button role="tab" aria-selected="${ui.tab === id}" class="${ui.tab === id ? 'selected' : ''}" data-action="tariff-tab" data-tab="${id}">${label}</button>`).join('')}</div><div class="tariff-content">${content}</div></aside>`;
}
function checkout() {
  const invoice = ui.checkout === 'invoice';
  const plans = ['Премиум', 'Премиум+', 'Максимальный'];
  return `<main class="checkout"><header class="checkout-header"><button class="text-button back" data-action="checkout-back">${icon('arrow', 'flip')} Вернуться назад</button><strong>Контур</strong><span class="pill-neutral">Прототип</span></header><h1>Покупка Контур.${invoice ? '%Продукт%' : 'Экстерн'}</h1><div class="checkout-steps"><span class="${!invoice ? 'selected' : ''}">Товары</span>${icon('arrow')}${invoice ? `<span>Реквизиты</span>${icon('arrow')}` : ''}<span class="${invoice ? 'selected' : ''}">Счет</span></div>
    ${invoice ? `<div class="invoice-grid"><section><h2>Выберите способ оплаты</h2><p>Демонстрационный счет. Отправка писем и реальная оплата в прототипе отключены.</p><div class="payment-grid">${['Оплата по карте', 'Оплата через СБП', 'Рассрочка 0% для физлиц', 'Оплата в личном кабинете банка', 'Счет', 'Подели на 4 платежа'].map((p, i) => `<button class="payment-option ${ui.payment === p ? 'selected' : ''}" data-action="payment" data-label="${p}">${icon(i % 2 ? 'ruble' : 'file')}<span>${p}</span></button>`).join('')}</div><h3>Почта для фискального чека</h3><input type="email" aria-label="Почта для фискального чека" placeholder="Вводить почту не нужно" disabled><button class="yellow checkout-pay" data-action="mock-pay">Перейти к оплате</button><p class="quiet">Нажатие покажет демонстрационное подтверждение.</p></section><aside class="invoice-summary"><span class="warning">Ожидает оплаты</span><h2>Счет № 1893010613 от 18.05.2024</h2><p class="quiet">Реквизиты</p><h3>ООО «Золотой пятачок»</h3><p>6663003127–997759991</p><p>Иванов Иван Иванович</p><p>+7 777 123-45-67, test@mail.ru</p><hr><div class="summary-line"><strong>Тариф Базовый</strong><span>40 000 ₽</span></div><p>– Для розницы, на 12 месяцев</p><p>– ЕГАИС, учет алкоголя</p><p>– ФСРАР</p><hr><div class="summary-line total"><strong>К оплате</strong><strong>40 000 ₽</strong></div><p>Всего бонусов <b>1 200</b></p></aside></div>` : `<div class="checkout-top"><h2>Выберите тариф</h2><div class="buyer-callout"><span>Укажите покупателя, чтобы увидеть точную стоимость</span><button data-action="buyer">Указать покупателя</button></div></div><div class="plans-grid">${plans.map((name, i) => `<article class="plan ${ui.selectedPlan === i ? 'selected' : ''}"><h2>${name}</h2><p>Поможем уверенно стартовать в торгах: зарегистрироваться в ЕИС, найти подходящие закупки и начать работу на площадке.</p><button class="text-button underline" data-action="plan-info" data-index="${i}">Что включено в тариф?</button><label class="tax-label">Налогообложение <select data-plan="${i}" aria-label="Налогообложение: ${name}" ${ui.selectedPlan !== i ? 'disabled' : ''}><option>ОСНО</option><option>УСН</option></select></label><div class="period"><span>на период</span><div>${[1, 12, 24, 36].map(n => `<button data-action="period" data-period="${n}" data-index="${i}" class="${ui.period === n ? 'selected' : ''}" ${ui.selectedPlan !== i ? 'disabled' : ''}>${n}</button>`).join('')}</div><span>месяцев</span></div><div class="plan-bottom"><strong>от ${['40 000', '56 700', '65 800'][i]} ₽</strong><button data-action="plan" data-index="${i}">${ui.selectedPlan === i ? icon('check') + ' Выбрано' : 'Выбрать'}</button></div></article>`).join('')}</div><section class="extra-options"><h2>Дополнительные опции</h2>${['Отчетность в Yandex Lens', 'Отчетность в РПН', 'Система лояльности'].map((name, i) => `<article><div><h3>Модуль «${name}»</h3><p class="muted">Скидка на второе и каждое последующее дополнительное рабочее место</p></div><button data-action="extra" data-index="${i}">Выбрать</button></article>`).join('')}</section><div class="checkout-bottom"><span>от ${['40 000', '56 700', '65 800'][ui.selectedPlan]} ₽</span><button class="primary" data-action="checkout-next">Далее ${icon('arrow')}</button></div>`}</main>`;
}
function answerModal() {
  if (!ui.answerModal) return '';
  const gaveUp = ui.answerModal === 'gave_up';
  return `<div class="modal-backdrop"><section class="answer-modal" role="dialog" aria-modal="true" aria-labelledby="answer-title"><button class="icon-button modal-close" data-action="cancel-answer" aria-label="Вернуться к заданию">${icon('close')}</button><span class="eyebrow">ЗАДАНИЕ ${ui.task} ИЗ 2</span><h2 id="answer-title">${gaveUp ? 'Что помешало найти информацию?' : 'Какую информацию вы нашли?'}</h2><p>${gaveUp ? 'Если хотите, коротко опишите, где возникла сложность.' : ui.task === 1 ? 'Напишите название тарифа Диадока и дату, до которой он действует.' : 'Напишите название тарифа Экстерна у ООО «Ромашка».'}</p><label for="task-answer">${gaveUp ? 'Комментарий (необязательно)' : 'Ваш ответ (необязательно)'}</label><textarea id="task-answer" rows="4" maxlength="2000" placeholder="Ваш ответ…"></textarea><button class="primary" data-action="submit-answer">${ui.task === 1 ? 'Перейти ко второму заданию' : 'Завершить исследование'} ${icon('arrow')}</button><button class="text-button" data-action="cancel-answer">Вернуться к заданию</button></section></div>`;
}
function renderPrototype() {
  app.innerHTML = `<div class="study-shell">${taskBar()}${ui.checkout ? checkout() : `<div class="cabinet">${sidebar()}${products()}${promos()}<button class="help-button" data-action="help" aria-label="Помощь">?</button></div>${panel()}`}<div class="study-footer"><span>Интерактивный прототип</span><span id="sync-status"></span></div>${answerModal()}</div>`;
  if (ui.answerModal) document.querySelector('#task-answer')?.focus();
  else if (ui.panel) document.querySelector('.drawer-close')?.focus({ preventScroll: true });
}
function renderDone() {
  app.innerHTML = `<main class="finished"><div class="finished-check">${icon('check')}</div><span class="eyebrow">ИССЛЕДОВАНИЕ ЗАВЕРШЕНО</span><h1>Спасибо за ваше время!</h1><p>Ваше прохождение поможет нам сделать кабинет клиента понятнее и удобнее.</p><div class="finish-results">${(study.results || []).map(r => `<div><span>Задание ${r.task}</span><strong>${r.outcome === 'completed' ? 'Выполнено' : 'Не получилось'}</strong></div>`).join('')}</div><p id="sync-status"></p><p class="quiet">Дождитесь сообщения «Данные сохранены», после этого вкладку можно закрыть.</p><button class="text-button" data-action="retry-sync">Повторить сохранение</button></main>`;
}
async function start() {
  if (working || !document.querySelector('#consent')?.checked) return;
  working = true;
  const button = document.querySelector('[data-action="start"]');
  button.disabled = true;
  button.textContent = 'Подключаемся…';
  try {
    const result = await api('/api/sessions', { width: innerWidth, height: innerHeight });
    study = { ...result, startedMs: Date.now(), seq: 0, queue: [], results: [] };
    ui.stage = 'study';
    study.taskStartedMs = Date.now();
    track('study_started', { width: innerWidth, height: innerHeight });
    track('task_started', { task: 1 });
    render(); view();
  } catch (error) { toast(`Не удалось начать исследование. ${error.message}`); button.disabled = false; button.innerHTML = `Начать исследование ${icon('arrow')}`; }
  working = false;
}
function submitAnswer() {
  if (!ui.answerModal) return;
  const result = { task: ui.task, outcome: ui.answerModal, answer: document.querySelector('#task-answer').value.trim(), durationMs: Date.now() - study.taskStartedMs };
  study.results.push(result);
  track('task_result', result);
  ui.answerModal = null;
  if (ui.task === 1) {
    ui.task = 2; ui.org = 'mine'; ui.panel = null; ui.menu = false; ui.checkout = null; ui.tab = 'current'; ui.minimizedTask = false;
    study.taskStartedMs = Date.now();
    track('task_started', { task: 2 });
    render(); view();
  } else { ui.stage = 'done'; track('study_completed', {}); render(); }
  save();
}
document.addEventListener('click', e => {
  if (study && ui.stage === 'study') {
    const target = e.target.closest('button, a, input, select, textarea, [data-action]');
    track('click', { action: target?.dataset.action || 'background', target: target?.dataset.label || target?.getAttribute('aria-label') || target?.textContent?.trim().slice(0, 100) || e.target.tagName.toLowerCase(), state: state(), organization: ui.org, product: ui.panel || '', task: ui.task, x: Math.round(e.clientX), y: Math.round(e.clientY), width: innerWidth, height: innerHeight });
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const action = el.dataset.action;
  if (action === 'start') return start();
  if (action === 'retry-sync') return flush();
  if (!study || ui.stage !== 'study') return;
  let changedState = false;
  switch (action) {
    case 'dismiss-tooltip': ui.tooltip = false; break;
    case 'organization-menu': ui.menu = !ui.menu; ui.tooltip = false; changedState = true; break;
    case 'select-org':
      if (ORGS.find(o => o.id === el.dataset.org)?.restricted) { toast('Для этой организации потребуется сертификат руководителя. В прототипе он недоступен.'); return; }
      ui.org = el.dataset.org; ui.menu = false; ui.panel = null; changedState = true; break;
    case 'product': ui.panel = el.dataset.product; ui.menu = false; ui.tooltip = false; ui.tab = 'current'; changedState = true; break;
    case 'close-panel': ui.panel = null; changedState = true; break;
    case 'tariff-tab': ui.tab = el.dataset.tab; changedState = true; break;
    case 'renew': ui.checkout = 'plans'; changedState = true; break;
    case 'invoice': ui.checkout = 'invoice'; changedState = true; break;
    case 'checkout-back': ui.checkout = null; changedState = true; break;
    case 'plan': ui.selectedPlan = Number(el.dataset.index); break;
    case 'period': ui.period = Number(el.dataset.period); break;
    case 'checkout-next': ui.checkout = 'invoice'; changedState = true; break;
    case 'payment': ui.payment = el.dataset.label; break;
    case 'mock-pay': toast('Это прототип: реальная оплата не выполняется.'); return;
    case 'buyer': toast('В прототипе используется демонстрационный покупатель.'); return;
    case 'plan-info': toast('Тариф включает регистрацию в ЕИС и помощь со стартом в торгах.'); return;
    case 'extra': toast('Дополнительная опция выбрана только в демонстрационном сценарии.'); return;
    case 'hide-promo': ui.hiddenPromos.push(Number(el.dataset.index)); break;
    case 'nav':
      if (el.dataset.label === 'Продукты') { ui.panel = null; ui.menu = false; changedState = true; }
      else if (el.dataset.label === 'Организации') { ui.menu = true; ui.tooltip = false; changedState = true; }
      else { toast('Этот раздел не входит в текущий прототип.'); return; }
      break;
    case 'task-toggle': ui.minimizedTask = !ui.minimizedTask; break;
    case 'task-complete': ui.answerModal = 'completed'; break;
    case 'task-giveup': ui.answerModal = 'gave_up'; break;
    case 'cancel-answer': ui.answerModal = null; break;
    case 'submit-answer': return submitAnswer();
    case 'help': toast('Выполните задание так, как вы бы действовали в настоящем кабинете. Если не получается, нажмите «Не получилось».'); return;
    case 'recommendation': case 'recommendations-prev': case 'recommendations-next': case 'add-organization': toast('Этот переход не входит в текущий прототип.'); return;
    default: return;
  }
  save(); render();
  if (changedState) view();
});
document.addEventListener('change', e => {
  if (e.target.matches('select[data-plan]')) track('click', { action: 'tax-system', target: e.target.value, task: ui.task, state: state() });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && study && ui.stage === 'study') {
    if (ui.answerModal) ui.answerModal = null;
    else if (ui.panel || ui.menu) { track('click', { action: 'escape', state: state(), task: ui.task }); ui.panel = null; ui.menu = false; view(); }
    save(); render();
  }
  if (e.key === 'Tab') {
    const dialog = document.querySelector('.answer-modal') || document.querySelector('.product-drawer');
    if (!dialog) return;
    const nodes = [...dialog.querySelectorAll('button:not([disabled]), textarea, input:not([disabled]), select:not([disabled])')];
    const first = nodes[0], last = nodes.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
});
document.addEventListener('visibilitychange', () => { if (study && ui.stage === 'study') track('visibility', { visibility: document.visibilityState, task: ui.task, state: state() }); });
addEventListener('online', flush);
addEventListener('pagehide', () => {
  if (!study) return;
  if (ui.stage === 'study') { study.seq++; study.queue.push({ seq: study.seq, type: 'page_exit', atMs: Date.now() - study.startedMs, data: { task: ui.task, state: state() } }); save(); }
  if (study.queue.length) {
    const data = JSON.stringify({ token: study.token, events: study.queue.slice(0, 100) });
    if (new Blob([data]).size < 60000) navigator.sendBeacon(`/api/sessions/${study.id}/events`, new Blob([data], { type: 'application/json' }));
  }
});
render();
if (study) flush();
