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

test('production remote analysis reaches a server result with a durable source', async ({ page }, testInfo) => {
  test.skip(process.env.PLAYWRIGHT_REMOTE_FLOW !== '1', 'Runs only against the deployed production stack');
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Production AI flow runs once');
  test.setTimeout(180_000);
  await page.goto('/analyze?mode=files');
  const pngBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 720;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#151525';
    context.font = '700 52px Arial';
    context.fillText('WORK ASSIGNMENT', 90, 130);
    context.font = '38px Arial';
    context.fillText('Prepare the project report.', 90, 250);
    context.fillText('Deadline: August 20, 2026.', 90, 340);
    context.fillText('Send it to the project manager.', 90, 430);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('[data-file-input]').setInputFiles({
    name: 'work-assignment.png',
    mimeType: 'image/png',
    buffer: Buffer.from(pngBase64, 'base64'),
  });
  await expect(page.getByText('work-assignment.png', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Создать понятный план/u }).click();
  await expect(page).toHaveURL(/\/result\//u, { timeout: 150_000 });
  await expect(page.getByText('Простое объяснение', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.task-item').first()).toBeVisible();

  const resultUrl = page.url();
  const analysisId = new URL(resultUrl).pathname.split('/').filter(Boolean).at(-1);
  await page.evaluate(async (id) => {
    const { dbGet, dbPut } = await import('/src/core/db.js');
    const stored = await dbGet('analyses', id);
    stored.sources = [];
    stored.pages = [];
    await dbPut('analyses', stored);
  }, analysisId);
  await page.reload();
  await expect(page.locator('[data-source-task]').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-source-task]').first().click();
  await expect(page.getByRole('dialog', { name: /Страница 1/u })).toBeVisible();
  await expect(page.locator('.source-preview__image img')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.source-highlight')).toBeVisible({ timeout: 30_000 });
});
