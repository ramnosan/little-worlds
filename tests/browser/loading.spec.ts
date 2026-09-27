import { test, expect } from '@playwright/test';

for (const level of ['jelly', 'bubbles', 'aquarium', 'railway', 'fire', 'airplane', 'plant']) {
  test(`${level} stays covered while its module loads`, async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const module = level === 'jelly' ? 'main.ts' : `${level}/level.ts`;
    await page.route(`**/src/${module}*`, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(`/?level=${level}`, { waitUntil: 'domcontentloaded' });
    try {
      await expect(page.locator('#level-loading')).toBeVisible();
      await expect(page.locator('#loading-title')).toContainText('Loading');
      await expect(page.locator('#app')).toHaveAttribute('inert', '');
      await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'true');
    } finally {
      release();
    }
    await expect(page.locator('#level-loading')).toHaveCount(0, { timeout: 45_000 });
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
    await expect(page.locator('#app')).not.toHaveAttribute('aria-busy', 'true');
  });
}

test('aquarium waits for fish assets', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/models/koi/manifest.json', async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/?level=aquarium', { waitUntil: 'domcontentloaded' });
  try {
    await expect(page.locator('#aq-koi-status')).toHaveText('Loading koi …');
    await expect(page.locator('#level-loading')).toBeVisible();
  } finally {
    release();
  }
  await expect(page.locator('#level-loading')).toHaveCount(0, { timeout: 45_000 });
});

test('failed loading offers a localized retry that reloads the level', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('jelly-studio.language', 'de'));
  await page.route('**/src/fire/level.ts*', (route) => route.abort());
  await page.goto('/?level=fire');
  await expect(page.locator('#loading-title')).toHaveText(
    'Diese kleine Welt konnte nicht geladen werden.',
  );
  await expect(page.locator('#loading-retry')).toBeVisible();
  await page.unroute('**/src/fire/level.ts*');
  await page.locator('#loading-retry').click();
  await expect(page.locator('#level-loading')).toHaveCount(0, { timeout: 45_000 });
  await expect(page.locator('canvas').first()).toBeVisible();
});
