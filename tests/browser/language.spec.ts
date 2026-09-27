import { test, expect, type Page } from '@playwright/test';

const levels = [
  {
    id: 'airplane',
    title: ['Model Flight · Little Worlds', 'Modellflug · Little Worlds'],
    pause: '#flight-pause',
    reset: '#flight-reset',
    status: '#flight-status',
    paused: ['Flight paused', 'Flug pausiert'],
  },
  {
    id: 'jelly',
    title: [
      'Little Worlds — A soft little space to play',
      'Little Worlds — Ein weicher kleiner Ort zum Spielen',
    ],
    pause: '#pause',
    reset: '#reset',
    status: '#live-label',
    paused: ['Taking a breather', 'Eine kleine Verschnaufpause'],
  },
  {
    id: 'bubbles',
    title: ['Bubbles · Little Worlds', 'Seifenblasen · Little Worlds'],
    pause: '#bubble-pause',
    reset: '#bubble-reset',
    status: '#bubble-count',
    paused: ['Time stands still', 'Die Zeit steht still'],
  },
  {
    id: 'aquarium',
    title: ['Aquarium · Little Worlds', 'Aquarium · Little Worlds'],
    pause: '#aq-pause',
    reset: '#aq-reset',
    status: '#aq-status',
    paused: ['Time stands still', 'Die Zeit steht still'],
  },
  {
    id: 'railway',
    title: ['Model Railway · Little Worlds', 'Modelleisenbahn · Little Worlds'],
    pause: '#rw-pause',
    reset: '#rw-reset',
    status: '#rw-status',
    paused: ['A little travel break', 'Eine kleine Reisepause'],
  },
  {
    id: 'fire',
    title: ['Campfire · Little Worlds', 'Lagerfeuer · Little Worlds'],
    pause: '#fire-pause',
    reset: '#fire-reset',
    status: '#fire-status',
    paused: ['A moment of stillness', 'Ein Moment Stille'],
  },
] as const;
const selector = (page: Page) => page.getByRole('combobox', { name: 'Language / Sprache' });

for (const [languageIndex, language] of ['en', 'de'].entries()) {
  test.describe(language, () => {
    // English must win even on a German browser; only an explicit saved choice selects German.
    test.use({ locale: 'de-DE' });
    test.beforeEach(async ({ page }) => {
      if (language === 'de')
        await page.addInitScript(() => localStorage.setItem('jelly-studio.language', 'de'));
    });
    for (const level of levels) {
      test(`${level.id} translates controls and dynamic states`, async ({ page }) => {
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text());
        });
        await page.goto(`/?level=${level.id}`);
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        await expect(page).toHaveTitle(level.title[languageIndex]);
        await expect(selector(page)).toHaveValue(language);
        await expect(
          page.getByRole('navigation', {
            name: language === 'de' ? 'Level wählen' : 'Choose level',
          }),
        ).toBeVisible();
        await page.locator(level.pause).click();
        await expect(page.locator(level.status)).toHaveText(level.paused[languageIndex]);
        await expect(page.locator(level.pause)).toHaveAttribute(
          'aria-label',
          language === 'de' ? 'Simulation fortsetzen' : 'Resume simulation',
        );
        await page.locator(level.reset).click();
        await expect(selector(page)).toHaveValue(language);
        if (level.id === 'jelly') {
          await page.locator('#help').click();
          await expect(page.getByRole('dialog')).toContainText(
            language === 'de' ? 'Greifen & dehnen' : 'Grab & stretch',
          );
          await page.locator('#help-close').click();
        }
        if (level.id === 'aquarium') {
          await expect(page.locator('#aq-quality')).toHaveText(
            language === 'de' ? 'Grafik: Hohe Qualität' : 'Graphics: High quality',
          );
          await page.locator('#aq-quality').click();
          await expect(page.locator('#aq-quality')).toHaveText(
            language === 'de' ? 'Grafik: Effizient' : 'Graphics: Efficient',
          );
          await expect(page.locator('#aq-quality')).toHaveAttribute('aria-pressed', 'true');
          await expect(page.locator('label[for="aq-time"]')).toContainText(
            language === 'de' ? 'Tageszeit' : 'Time of day',
          );
          await expect(page.locator('#aq-cycle')).toHaveAccessibleName(
            language === 'de' ? 'Automatischer Wechsel' : 'Automatic cycle',
          );
          await page.locator('#aq-ball').click();
          await expect(page.locator('#aq-count')).toHaveText(
            language === 'de' ? '1 / 6 Schwimmball' : '1 / 6 floating ball',
          );
          await page.locator('#aq-ball').click();
          await expect(page.locator('#aq-count')).toHaveText(
            language === 'de' ? '2 / 6 Schwimmbälle' : '2 / 6 floating balls',
          );
        }
        expect(errors).toEqual([]);
      });
    }
    for (const width of [1440, 1024, 390]) {
      test(`all headers fit at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        for (const level of levels) {
          await page.goto(`/?level=${level.id}`);
          await expect(selector(page)).toBeVisible();
          await expect(selector(page)).toBeInViewport();
          await expect(page.locator('.level-nav')).toBeInViewport();
          const layout = await page.locator('.studio-header').evaluate((header) => {
            const rects = [...header.children].map((el) => el.getBoundingClientRect());
            return {
              overflow: document.documentElement.scrollWidth > innerWidth,
              overlap: rects.some((a, i) =>
                rects
                  .slice(i + 1)
                  .some(
                    (b) =>
                      a.left < b.right - 1 &&
                      a.right > b.left + 1 &&
                      a.top < b.bottom - 1 &&
                      a.bottom > b.top + 1,
                  ),
              ),
            };
          });
          expect(layout, `${level.id} ${language} ${width}`).toEqual({
            overflow: false,
            overlap: false,
          });
          await page.screenshot({
            path: `artifacts/language-${level.id}-${language}-${width}.png`,
            fullPage: true,
          });
        }
      });
    }
  });
}

test('switch restarts the same level, preserves URL, and persists across navigation', async ({
  page,
}) => {
  await page.goto('/?level=aquarium&example=keep#scene');
  await page.locator('#aq-ball').click();
  await expect(page.locator('#aq-count')).toHaveText('1 / 6 floating ball');
  await selector(page).selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page).toHaveURL(/\?level=aquarium&example=keep#scene$/);
  await expect(page.locator('#aq-count')).toHaveText('0 / 6 Schwimmbälle');
  await page.reload();
  await expect(selector(page)).toHaveValue('de');
  for (const name of ['02 Seifenblasen', '04 Modelleisenbahn', '05 Lagerfeuer', '01 Jelly']) {
    await page.getByRole('link', { name, exact: true }).click();
    await expect(selector(page)).toHaveValue('de');
  }
  await page.locator('#spawn').click();
  await expect(page.locator('#body-count')).toHaveText('4 Jellies');
  await selector(page).selectOption('de');
  await expect(page.locator('#body-count')).toHaveText('4 Jellies');
  await selector(page).selectOption('en');
  await expect(page.locator('#body-count')).toHaveText('3 jellies');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('selector keyboard input does not trigger gameplay shortcuts', async ({ page }) => {
  for (const level of levels) {
    await page.goto(`/?level=${level.id}`);
    await page.locator(level.pause).click();
    await selector(page).focus();
    await page.keyboard.press('n');
    await page.keyboard.press('r');
    await page.keyboard.press('p');
    await expect(page.locator(level.status)).toHaveText(level.paused[0]);
  }
  await selector(page).press('Home');
  await selector(page).press('ArrowDown');
  await selector(page).press('Enter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

for (const blocked of [false, true]) {
  test(
    blocked ? 'blocked storage avoids reload loops' : 'invalid preference defaults to English',
    async ({ page }) => {
      await page.addInitScript((blocked) => {
        if (blocked)
          Object.defineProperty(window, 'localStorage', {
            get: () => {
              throw new DOMException('blocked', 'SecurityError');
            },
          });
        else localStorage.setItem('jelly-studio.language', 'fr');
      }, blocked);
      await page.goto('/');
      await expect(selector(page)).toHaveValue('en');
      if (blocked) {
        await page.locator('#spawn').click();
        await selector(page).selectOption('de');
        await expect(selector(page)).toHaveValue('en');
        await expect(page.locator('#language-hint')).toBeVisible();
        await expect(page.locator('#language-hint')).toContainText('Language could not be saved');
        await expect(page.locator('#body-count')).toHaveText('4 jellies');
      }
    },
  );
}

test('language switching remains available after WebGL initialization fails', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type.startsWith('webgl')) return null;
      return original.apply(this, [type, ...args] as Parameters<typeof original>);
    } as typeof original;
  });
  for (const level of levels) {
    await page.goto(`/?level=${level.id}`);
    await expect(page.getByRole('alert')).toContainText('WebGL 2');
    await expect(selector(page)).toBeEnabled();
    await selector(page).selectOption('de');
    await expect(page.getByRole('alert')).toContainText('Hardwarebeschleunigung');
    await selector(page).selectOption('en');
    await expect(page.getByRole('alert')).toContainText('hardware acceleration');
  }
});
