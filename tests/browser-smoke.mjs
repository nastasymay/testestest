// Optional browser checks: set PLAYWRIGHT_MODULE to an installed @playwright/test entry.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
const { chromium, expect } = await import(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const dataDir = mkdtempSync(join(tmpdir(), 'research-browser-'));
const artifacts = process.env.ARTIFACT_DIR || join(tmpdir(), 'prototype-artifacts');
mkdirSync(artifacts, { recursive: true });
const app = process.env.RESEARCH_BASE_URL ? null : createApp({ dataDir, adminPassword: 'browser-test-password', secureCookies: false });
if (app) await new Promise(done => app.server.listen(0, '127.0.0.1', done));
const url = process.env.RESEARCH_BASE_URL || `http://127.0.0.1:${app.server.address().port}`;
const auth = await fetch(url + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'browser-test-password' }) });
const invitation = await (await fetch(url + '/api/admin/invitation', { headers: { Cookie: auth.headers.get('set-cookie').split(';')[0] } })).json();
const inviteUrl = url + invitation.path;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text()); });
const start = async target => {
  await target.goto(inviteUrl);
  if (process.env.RESEARCH_PARTICIPANT_PASSWORD && await target.locator('#access-form').count()) {
    await target.locator('#password').fill(process.env.RESEARCH_PARTICIPANT_PASSWORD);
    await target.getByRole('button', { name: 'Открыть прототип' }).click();
  }
  await target.locator('#consent').check();
  await target.locator('[data-action=start]').click();
  await expect(target.locator('.task-label')).toHaveText('Задание 1 из 2');
  await target.locator('[data-action=dismiss-tooltip]').click();
};
try {
  await page.goto(inviteUrl);
  if (process.env.RESEARCH_PARTICIPANT_PASSWORD && await page.locator('#access-form').count()) {
    await page.locator('#password').fill(process.env.RESEARCH_PARTICIPANT_PASSWORD);
    await page.getByRole('button', { name: 'Открыть прототип' }).click();
  }
  await expect(page.locator('[data-action=start]')).toBeDisabled();
  await page.screenshot({ path: join(artifacts, 'welcome.png'), fullPage: true });
  await start(page);
  await page.screenshot({ path: join(artifacts, 'products.png'), fullPage: true });
  await page.locator('[data-product=diadoc]').click();
  await expect(page.locator('.product-drawer')).toContainText('Общий плюс, 1+9 организаций на обслуживании, на 24 мес.');
  await expect(page.locator('.product-drawer')).toContainText('до 10 ноября 2026');
  await page.screenshot({ path: join(artifacts, 'diadoc.png'), fullPage: true });
  await page.locator('[data-action=tariff-tab][data-tab=future]').click();
  await expect(page.locator('.empty-tariffs')).toContainText('Будущих тарифов пока нет');
  await page.locator('[data-action=tariff-tab][data-tab=current]').click();
  await page.locator('[data-action=task-complete]').click();
  await page.locator('#task-answer').fill('Общий плюс, 24 мес., до 10 ноября 2026');
  await page.locator('[data-action=submit-answer]').click();
  await expect(page.locator('.task-label')).toHaveText('Задание 2 из 2');
  await page.locator('[data-action=organization-menu]').click();
  await expect(page.locator('.organization-menu')).toContainText('Потребуется сертификат руководителя');
  await page.locator('[data-action=select-org][data-org=romashka]').hover();
  await page.screenshot({ path: join(artifacts, 'organizations.png'), fullPage: true });
  await page.locator('[data-action=select-org][data-org=romashka]').click();
  await expect(page.locator('.organization-button')).toContainText('Ромашка');
  await page.locator('[data-product=extern]').click();
  await expect(page.locator('.product-drawer')).toContainText('Тариф оптимальный плюс');
  await page.screenshot({ path: join(artifacts, 'extern.png'), fullPage: true });
  await page.locator('[data-action=renew]').click();
  await expect(page.locator('.checkout')).toContainText('Выберите тариф');
  await page.locator('[data-action=plan][data-index="1"]').click();
  await page.locator('[data-action=period][data-period="24"][data-index="1"]').click();
  await page.screenshot({ path: join(artifacts, 'renewal.png'), fullPage: true });
  await page.locator('[data-action=checkout-next]').click();
  await expect(page.locator('.invoice-summary')).toContainText('Счет № 1893010613');
  await page.locator('[data-action=checkout-back]').click();
  await page.locator('[data-action=invoice]').click();
  await expect(page.locator('.checkout')).toContainText('Выберите способ оплаты');
  await page.locator('[data-action=checkout-back]').click();
  await page.locator('[data-action=task-complete]').click();
  await page.locator('#task-answer').fill('Тариф оптимальный плюс');
  await page.locator('[data-action=submit-answer]').click();
  await expect(page.locator('.finished')).toContainText('Спасибо за ваше время!');
  await expect(page.locator('#sync-status')).toHaveText('Данные сохранены', { timeout: 15000 });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on('pageerror', error => errors.push(error.message));
  await start(mobile);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No mobile horizontal overflow');
  await mobile.screenshot({ path: join(artifacts, 'mobile.png'), fullPage: true });
  await expect(mobile.locator('#sync-status')).toHaveText('Данные сохранены');
  await mobile.context().setOffline(true);
  await mobile.locator('[data-product=diadoc]').click();
  await mobile.locator('[data-action=task-giveup]').click();
  await mobile.locator('[data-action=submit-answer]').click();
  await expect(mobile.locator('.task-label')).toHaveText('Задание 2 из 2');
  await mobile.reload().catch(() => {});
  // Reload cannot load a non-cached app offline; return online and restore saved state.
  await mobile.context().setOffline(false);
  await mobile.goto(url);
  await expect(mobile.locator('.task-label')).toHaveText('Задание 2 из 2');
  await expect(mobile.locator('#sync-status')).toHaveText('Данные сохранены', { timeout: 15000 });
  await mobile.locator('[data-action=organization-menu]').click();
  await mobile.locator('[data-action=select-org][data-org=romashka]').click();
  await mobile.locator('[data-product=extern]').click();
  await mobile.screenshot({ path: join(artifacts, 'mobile-extern.png'), fullPage: true });
  await mobile.locator('[data-action=close-panel]').last().click();
  await mobile.locator('[data-action=task-giveup]').click();
  await mobile.locator('[data-action=submit-answer]').click();
  await expect(mobile.locator('#sync-status')).toHaveText('Данные сохранены', { timeout: 15000 });

  const admin = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
  admin.on('pageerror', error => errors.push(error.message));
  await admin.goto(url + '/admin');
  await admin.locator('#password').fill('wrong-password');
  await admin.getByRole('button', { name: 'Войти' }).click();
  await expect(admin.locator('.login-error')).toHaveText('Неверный пароль.');
  await admin.locator('#password').fill('browser-test-password');
  await admin.getByRole('button', { name: 'Войти' }).click();
  await expect(admin.locator('tbody tr')).toHaveCount(process.env.RESEARCH_BASE_URL ? 4 : 2);
  await admin.screenshot({ path: join(artifacts, 'results.png'), fullPage: true });
  await admin.locator('[data-action=detail]').nth(1).click();
  await expect(admin.locator('.detail-panel')).toContainText('Тариф оптимальный плюс');
  await expect(admin.locator('.detail-panel')).toContainText('Диадок · Действующие тарифы');
  await admin.screenshot({ path: join(artifacts, 'participant-path.png'), fullPage: true });
  const exported = await (await admin.request.get(url + '/api/admin/export.json')).json();
  assert.equal(exported.sessions.length, process.env.RESEARCH_BASE_URL ? 4 : 2);
  assert.equal(exported.sessions.filter(s => s.status === 'completed').length, process.env.RESEARCH_BASE_URL ? 3 : 2);
  assert.equal(exported.sessions.find(s => s.tasks[0].outcome === 'gave_up').tasks[0].relevantScreenVisited, true, 'Offline events are delivered after reconnect');
  assert.equal(exported.sessions.find(s => s.tasks[0].outcome === 'completed').tasks[1].relevantScreenVisited, true);
  const csv = await (await admin.request.get(url + '/api/admin/export.csv')).text();
  assert.match(csv, /Тариф оптимальный плюс/);
  assert.deepEqual(errors, [], 'No browser JavaScript or CSP errors');
  console.log('Browser checks passed: desktop, mobile, both tasks, renewal, invoice, offline queue, reload recovery, admin login, timeline and exports.');
  console.log('Screenshots:', artifacts);
} catch (error) {
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  if (app) await app.close();
  rmSync(dataDir, { recursive: true, force: true });
}
