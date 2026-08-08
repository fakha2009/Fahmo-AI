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
});

test('production remote analysis reaches a server result', async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_REMOTE_FLOW !== '1', 'Runs only against the deployed production stack');
  test.setTimeout(180_000);
  await page.goto('/analyze?mode=text');
  await page.locator('#document-text').fill('Поручение: до 20 августа 2026 года подготовить отчёт о проекте и отправить его руководителю.');
  await page.getByRole('button', { name: /Создать понятный план/u }).click();
  await expect(page).toHaveURL(/\/result\//u, { timeout: 150_000 });
  await expect(page.getByText('Простое объяснение', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.task-item').first()).toBeVisible();
});
