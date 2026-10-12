const fields = ['action', 'target', 'state', 'organization', 'product', 'tab', 'task', 'outcome', 'answer', 'durationMs', 'x', 'y', 'width', 'height', 'visibility', 'reason'];
const types = new Set(['study_started', 'task_started', 'click', 'state_view', 'task_result', 'study_completed', 'visibility', 'page_exit']);
const states = new Set(['products.mine', 'products.organization', 'organization.menu', 'diadoc.current', 'diadoc.future', 'diadoc.archive', 'extern.current', 'extern.future', 'extern.archive', 'tolk.current', 'tolk.future', 'tolk.archive', 'checkout.plans', 'checkout.invoice']);
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
export function validateEvents(events) {
  if (!Array.isArray(events) || !events.length || events.length > 100) invalid('Некорректный пакет событий.');
  return events.map(event => {
    if (!event || !Number.isSafeInteger(event.seq) || event.seq < 1 || event.seq > 100000 || !types.has(event.type) || !Number.isSafeInteger(event.atMs) || event.atMs < 0 || event.atMs > 604800000 || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) invalid('Некорректное событие.');
    const safe = {};
    for (const field of fields) {
      const v = event.data[field];
      if (typeof v === 'string') safe[field] = v.slice(0, field === 'answer' ? 2000 : 150);
      if (typeof v === 'number' && Number.isFinite(v)) safe[field] = v;
    }
    if (event.type === 'state_view' && !states.has(safe.state)) invalid('Неизвестный экран.');
    if (['task_started', 'task_result'].includes(event.type) && ![1, 2].includes(safe.task)) invalid('Неизвестное задание.');
    if (event.type === 'task_result' && !['completed', 'gave_up'].includes(safe.outcome)) invalid('Некорректный результат.');
    return { seq: event.seq, type: event.type, atMs: event.atMs, data: safe };
  });
}
export function summarize(row, events) {
  const tasks = [1, 2].map(task => {
    const start = events.find(e => e.type === 'task_started' && e.data.task === task);
    const result = events.find(e => e.type === 'task_result' && e.data.task === task);
    const relevant = events.find(e => e.type === 'state_view' && e.seq > (start?.seq ?? Infinity) && e.seq < (result?.seq ?? Infinity) && (task === 1 ? e.data.state === 'diadoc.current' : e.data.state === 'extern.current' && e.data.organization === 'romashka'));
    return { task, outcome: result?.data.outcome || 'unrun', answer: result?.data.answer || '', durationMs: result && start ? Math.max(0, result.atMs - start.atMs) : null, relevantScreenVisited: Boolean(relevant), timeToRelevantScreenMs: relevant && start ? Math.max(0, relevant.atMs - start.atMs) : null };
  });
  return { id: row.id, startedAt: row.started_at, lastSeen: row.last_seen, status: row.status, viewport: JSON.parse(row.viewport), clicks: events.filter(e => e.type === 'click').length, durationMs: events.at(-1)?.atMs ?? 0, tasks, path: events.filter(e => e.type === 'state_view').map(e => e.data.state), eventCount: events.length };
}
export function exportCsv(sessions) {
  const quote = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [['session', 'started_at', 'status', 'clicks', 'duration_ms', 'task', 'outcome', 'task_duration_ms', 'relevant_screen_visited', 'time_to_relevant_screen_ms', 'answer']];
  for (const s of sessions) for (const t of s.tasks) rows.push([s.id, s.startedAt, s.status, s.clicks, s.durationMs, t.task, t.outcome, t.durationMs, t.relevantScreenVisited, t.timeToRelevantScreenMs, t.answer]);
  return '\ufeff' + rows.map(r => r.map(quote).join(',')).join('\r\n');
}
