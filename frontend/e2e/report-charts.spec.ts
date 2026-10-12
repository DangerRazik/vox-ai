import { expect, test } from '@playwright/test';

test('график отчёта и сравнение без графика доступны на узком экране', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo/customer/batches/batch-04/report');
  const bars = page.getByRole('figure', { name: 'График оценок критериев' });
  await expect(bars.getByRole('listitem')).toHaveCount(11);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/demo/customer/comparison?stream=incoming&batch=batch-04&batch=batch-01');
  await page.getByRole('button', { name: 'Сравнить выбранные батчи' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('figure')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Сравнить выбранные батчи' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Изменить выбор' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.scratch/runtime/comparison-result-mobile.png', fullPage: true });
});

test('сворачивание с клавиатуры сохраняется после перезагрузки, итог и нарушение видны', async ({
  page,
}) => {
  await page.goto('/demo/customer/batches/batch-04/report');
  await page
    .getByRole('row')
    .filter({ hasText: 'call_002.mp3' })
    .getByRole('link', { name: 'call_002.mp3', exact: true })
    .click();
  const toggle = page.getByRole('button', { name: 'Транскрипция', exact: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#report-content-transcript')).toBeHidden();
  await page.getByRole('button', { name: 'Исходные оценки критериев', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Итоговая оценка' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Критическое нарушение', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.locator('#report-content-transcript')).toBeVisible();
});
