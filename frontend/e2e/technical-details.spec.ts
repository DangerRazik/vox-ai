import { expect, test } from '@playwright/test';

test('ID стрима отображается мелким серым текстом внизу карточки', async ({ page }) => {
  await page.goto('/demo/customer/streams?organization=contact-center&stream=outgoing');
  const stream = page.getByRole('article', { name: 'Исходящие обращения' });
  const ids = stream.locator('app-technical-details');
  await expect(ids.locator('code')).toBeVisible();
  await expect(ids.locator('code')).toHaveText('outgoing');
  await expect(ids.locator('p')).toHaveCSS('font-size', '11px');
  await expect(ids.locator('p')).toHaveCSS('color', 'rgb(119, 129, 143)');
  await expect(ids.locator('details, button')).toHaveCount(0);
  expect(await ids.evaluate(el => el === el.parentElement?.lastElementChild)).toBe(true);
});
