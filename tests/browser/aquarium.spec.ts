import { test, expect, type Page } from '@playwright/test';

const stats = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __aquariumDebug: () => {
          time: number;
          paused: boolean;
          balls: number;
          interactions: number;
          geometries: number;
          textures: number;
          camera: number[];
        };
      }
    ).__aquariumDebug(),
  );
test('aquarium loads, simulates, pauses, resets and keeps GPU resources bounded', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?level=aquarium');
  await expect(page.locator('#aquarium-world canvas')).toBeVisible();
  await expect.poll(async () => (await stats(page)).time).toBeGreaterThan(0.2);
  await page.screenshot({ path: 'artifacts/aquarium-desktop.png' });
  await page.getByRole('button', { name: 'Make a wave' }).click();
  expect((await stats(page)).interactions).toBe(1);
  await page.getByRole('button', { name: 'Add a floating ball' }).click();
  await expect(page.locator('#aq-count')).toHaveText('1 / 6 floating ball');
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  const paused = await stats(page);
  await page.waitForTimeout(250);
  expect((await stats(page)).time).toBe(paused.time);
  await expect(page.locator('#aq-ball')).toBeDisabled();
  await expect(page.locator('#aq-ripple')).toBeDisabled();
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect.poll(async () => (await stats(page)).balls).toBe(0);
  await expect
    .poll(async () => (await stats(page)).geometries)
    .toBeLessThanOrEqual(paused.geometries);
  const baseline = await stats(page);
  for (let i = 0; i < 3; i++) {
    await page.locator('#aq-ball').click();
    await page.locator('#aq-reset').click();
  }
  await expect.poll(async () => (await stats(page)).geometries).toBe(baseline.geometries);
  expect((await stats(page)).textures).toBe(baseline.textures);
  await page.locator('#aq-quality').click();
  await expect(page.locator('#aq-quality')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});
test('surface interaction, orbit and navigation between all three levels', async ({ page }) => {
  await page.goto('/?level=aquarium');
  await expect(page.locator('canvas')).toBeVisible();
  const canvas = page.locator('#aquarium-world canvas'),
    box = (await canvas.boundingBox())!;
  const x = box.x + box.width * 0.5,
    y = box.y + box.height * 0.45;
  await page.mouse.click(x, y);
  await expect.poll(async () => (await stats(page)).interactions).toBeGreaterThan(0);
  const camera = (await stats(page)).camera;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x + 80, y + 25, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  expect((await stats(page)).camera).not.toEqual(camera);
  await page.locator('#aq-reset').click();
  const restored = (await stats(page)).camera;
  restored.forEach((value, i) => expect(value).toBeCloseTo(camera[i], 5));
  await page.getByRole('link', { name: '02 Bubbles' }).click();
  await expect(page.locator('#bubble-world canvas')).toBeVisible();
  await page.getByRole('link', { name: '03 Aquarium' }).click();
  await expect(page.locator('#aquarium-world canvas')).toBeVisible();
  await page.getByRole('link', { name: '01 Jelly' }).click();
  await expect(page.locator('#world canvas')).toBeVisible();
  await page.getByRole('link', { name: '03 Aquarium' }).click();
  await expect(page.locator('#aquarium-world canvas')).toBeVisible();
});

test('wave button charges on hold, releases once outside the button and cancels on blur', async ({
  page,
}) => {
  await page.goto('/?level=aquarium');
  const button = page.getByRole('button', { name: 'Make a wave' });
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(button).toHaveClass('is-charging');
  await expect
    .poll(async () => Number((await button.innerText()).match(/(\d+)%/)?.[1]))
    .toBeGreaterThan(10);
  expect((await stats(page)).interactions).toBe(0);
  await page.mouse.move(box.x, box.y - 30);
  await page.mouse.up();
  expect((await stats(page)).interactions).toBe(1);
  await expect(button).toHaveText('◎ Make a wave');
  await button.focus();
  await page.keyboard.down('Space');
  await expect(button).toHaveClass('is-charging');
  await page.keyboard.up('Space');
  expect((await stats(page)).interactions).toBe(2);
  await page.keyboard.down('Enter');
  await expect(button).toHaveClass('is-charging');
  await page.keyboard.up('Enter');
  expect((await stats(page)).interactions).toBe(3);
  await page.keyboard.down('Space');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Space');
  await expect(button).not.toHaveClass('is-charging');
  expect((await stats(page)).interactions).toBe(3);
});
test('mobile layout and touch ripple', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/?level=aquarium');
  await expect(page.locator('canvas')).toBeVisible();
  await expect.poll(async () => (await stats(page)).time).toBeGreaterThan(0.1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/aquarium-mobile.png', fullPage: true });
  const box = (await page.locator('canvas').boundingBox())!;
  await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await expect.poll(async () => (await stats(page)).interactions).toBeGreaterThan(0);
  await page.locator('#aq-ball').click();
  await expect(page.locator('#aq-count')).toHaveText('1 / 6 floating ball');
  const ripple = page.getByRole('button', { name: 'Make a wave' });
  await ripple.scrollIntoViewIfNeeded();
  const rippleBox = (await ripple.boundingBox())!;
  const before = (await stats(page)).interactions;
  const touch = await context.newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: rippleBox.x + rippleBox.width / 2, y: rippleBox.y + rippleBox.height / 2 }],
  });
  await expect
    .poll(async () => Number((await ripple.innerText()).match(/(\d+)%/)?.[1]))
    .toBeGreaterThan(10);
  expect((await stats(page)).interactions).toBe(before);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(ripple).toHaveText('◎ Make a wave');
  expect((await stats(page)).interactions).toBe(before + 1);
  await context.close();
});
