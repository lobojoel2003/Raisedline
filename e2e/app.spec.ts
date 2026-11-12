import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  (page as unknown as { errors: string[] }).errors = errors;
});

test.afterEach(async ({ page }) => {
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
});

test('shows the sighted and tactile versions side by side with a touch score', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Sighted' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tactile' })).toBeVisible();
  await expect(page.locator('.sheet.tactile [data-rl-id="bar-0-0"]')).toBeVisible();
  await expect(page.locator('.sheet.sighted [data-rl-id="bar-0-0"]')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Touch score 100 out of 100' })).toBeVisible();
  await expect(page.getByText('Ready to print')).toBeVisible();
});

test('hovering a tactile bar highlights its sighted twin', async ({ page }) => {
  await page.goto('./');
  await page.locator('.sheet.tactile [data-rl-id="bar-1-2"]').hover();
  await expect(page.locator('.sheet.sighted [data-rl-id="bar-1-2"]')).toHaveClass(/rl-hl/);
  await expect(page.locator('.tooltip')).toContainText('2025, Mar: 52');
});

test('touch preview flags crossing lines and locates an issue', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Temperatures (needs work)' }).click();
  await expect(page.getByText(/Review the flagged areas|Needs rework/)).toBeVisible();
  const first = page.locator('.issues .issue').first();
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.overlay .issue-box.selected')).toHaveCount(1);
});

test('each source tab builds a graphic', async ({ page }) => {
  await page.goto('./');
  for (const [tab, title] of [
    ['Diagram', 'The water cycle'],
    ['Map', 'Riverside Campus'],
    ['Image', 'Plant cell'],
  ] as const) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.locator('.sheet.tactile svg[role="img"]')).toHaveAttribute(
      'aria-label',
      `Tactile version: ${title}`,
    );
    await expect(page.locator('.verdict')).toBeVisible();
  }
});

test('editing CSV data rebuilds the chart', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Pie', exact: true }).click();
  await expect(page.locator('.sheet.tactile [data-rl-id="slice-0"]')).toBeVisible();
  await page.getByLabel('Title').fill('Rain by month');
  await expect(page.locator('.sheet.tactile svg[role="img"]')).toHaveAttribute(
    'aria-label',
    'Tactile version: Rain by month',
  );
});

test('exports PDF, STL and BRF files', async ({ page }) => {
  await page.goto('./');
  for (const [label, ext] of [
    ['Swell paper (PDF)', '.pdf'],
    ['3D print (STL)', '.stl'],
    ['Braille embosser (BRF)', '.brf'],
  ] as const) {
    await page.getByRole('button', { name: 'Export' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: new RegExp(label.replace(/[()]/g, '\\$&')) }).click();
    expect((await download).suggestedFilename()).toBe(`monthly-rainfall-mm${ext}`);
  }
});

test('is keyboard navigable', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to the graphic' })).toBeFocused();
  await page.getByRole('tab', { name: 'Map' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');
});

test('shows the version and build number', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.footer')).toContainText(/Raisedline 1\.0\.0\+build\.\d+/);
});
