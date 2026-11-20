const { expect, test } = require('@playwright/test');

test('pastes and copies the original text, with readable wrapping on a narrow screen', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native clipboard permissions are granted in Chromium.');

  const source = `確認用の文章です。\n\n<em>文字のまま表示</em>\n${'long-unbroken-text'.repeat(20)}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.evaluate(text => navigator.clipboard.writeText(text), source);
  await page.keyboard.press('ControlOrMeta+V');

  const reading = page.getByRole('article');
  await expect(reading).toBeVisible();
  expect(await reading.textContent()).toBe(source);
  await expect(reading).toHaveCSS('font-size', '26px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);

  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);

  await page.evaluate(() => navigator.clipboard.writeText('続けて貼り付けた文章'));
  await page.keyboard.press('ControlOrMeta+V');
  await expect(reading).toHaveText('続けて貼り付けた文章');
});

test('reopens with an empty page in a new tab, after reload and after history traversal', async ({ page, context, browserName }) => {
  await page.addInitScript(() => {
    window.addEventListener('pageshow', event => {
      window.restoredFromHistoryCache = event.persisted;
    });
  });
  await page.goto('/');
  const input = page.getByRole('textbox');
  const reading = page.getByRole('article', { includeHidden: true });
  const source = '開き直すと消える文章';
  const paste = () => input.evaluate((element, pasted) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', pasted);
    element.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData,
      bubbles: true,
      cancelable: true,
    }));
  }, source);

  await paste();
  await expect(reading).toHaveText(source);

  const newTab = await context.newPage();
  await newTab.goto(page.url());
  await expect(newTab.getByRole('textbox')).toHaveValue('');
  await newTab.close();

  await page.reload();
  await expect(input).toHaveValue('');
  await expect(reading).toBeHidden();

  await paste();
  await expect(reading).toHaveText(source);
  await page.goto('/?away');
  await page.goBack({ waitUntil: 'commit' });
  await expect(input).toHaveValue('');
  await expect(reading).toBeHidden();
  await expect(reading).toBeEmpty();
  if (browserName === 'chromium') {
    await expect.poll(() => page.evaluate(() => window.restoredFromHistoryCache)).toBe(true);
  }
});
