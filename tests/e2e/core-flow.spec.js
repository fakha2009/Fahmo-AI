import { expect, test } from '@playwright/test';

test('home is branded, responsive, and exposes the primary action', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Fahmo AI/u);
  await expect(page.locator('.hero__eyebrow').getByText('Fahmo AI', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Из документа — в понятный план' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Добавить документ/u })).toBeVisible();
  await expect(page.getByText('В сети', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Добавить документ/u }).click();
  await expect(page).toHaveURL(/\/analyze$/u);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Фаҳмо AI|Demo document|Local-first/u);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('upload deep links wait for a real user action before opening the file picker', async ({ page }) => {
  await page.addInitScript(() => {
    const originalClick = HTMLInputElement.prototype.click;
    window.__fileInputClicks = 0;
    HTMLInputElement.prototype.click = function click() {
      if (this.type === 'file') window.__fileInputClicks += 1;
      return originalClick.call(this);
    };
  });

  await page.goto('/analyze?mode=files');
  await expect(page.getByRole('button', { name: 'Выбрать файл' }).first()).toBeFocused();
  expect(await page.evaluate(() => window.__fileInputClicks)).toBe(0);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Выбрать файл' }).first().click();
  await chooser;
  expect(await page.evaluate(() => window.__fileInputClicks)).toBe(1);
});

test('mobile home keeps the document illustration readable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'Mobile composition check');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const visual = page.locator('.hero__visual img:visible');
  await expect(visual).toBeVisible();
  const box = await visual.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(320);
  await expect(page.locator('.mobile-nav__link[aria-current="page"]')).toHaveCSS('border-top-color', /rgb/u);
});

test('local example completes the document-to-plan flow', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Попробовать на примере/u }).first().click();
  await expect(page).toHaveURL(/\/analyze\?mode=text/u);
  await expect(page.locator('#document-text')).toHaveValue(/Регистрация участников/u);
  await page.getByRole('button', { name: /Создать понятный план/u }).click();
  await expect(page).toHaveURL(/\/result\//u, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /Объявление о регистрации/u }).first()).toBeVisible();
  await expect(page.getByText('Что нужно сделать', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.task-item').first()).toBeVisible();
  await page.locator('[data-source-task]').first().click();
  await expect(page.getByRole('dialog', { name: /Страница 1/u })).toBeVisible();
  await expect(page.locator('[data-source-mark]')).toBeVisible();
  await expect(page.locator('.source-quote')).toContainText(/Необходимо заполнить/u);
});

test('production remote analysis reaches a server result with a durable source', async ({ page, browser }, testInfo) => {
  test.skip(process.env.PLAYWRIGHT_REMOTE_FLOW !== '1', 'Runs only against the deployed production stack');
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Production AI flow runs once');
  test.setTimeout(180_000);
  await page.goto('/analyze?mode=text');
  await page.locator('#document-text').fill('Поручение: до 20 августа 2026 года подготовить отчёт о проекте и отправить его руководителю.');
  await page.getByRole('button', { name: /Создать понятный план/u }).click();
  await expect(page).toHaveURL(/\/result\//u, { timeout: 150_000 });
  await expect(page.getByText('Простое объяснение', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.task-item').first()).toBeVisible();

  const resultUrl = page.url();
  const sessionToken = await page.evaluate(() => sessionStorage.getItem('fahmo:api-session'));
  expect(sessionToken).toBeTruthy();
  const sourceContext = await browser.newContext();
  await sourceContext.addInitScript((token) => sessionStorage.setItem('fahmo:api-session', token), sessionToken);
  const sourcePage = await sourceContext.newPage();
  await sourcePage.goto(resultUrl);
  await expect(sourcePage.locator('[data-source-task]').first()).toBeVisible({ timeout: 30_000 });
  await sourcePage.locator('[data-source-task]').first().click();
  await expect(sourcePage.getByRole('dialog', { name: /Страница 1/u })).toBeVisible();
  await expect(sourcePage.locator('[data-source-mark]')).toBeVisible({ timeout: 30_000 });
  await sourceContext.close();
});
