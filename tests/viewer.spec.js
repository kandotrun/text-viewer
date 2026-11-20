const { expect, test } = require('@playwright/test');

test('types, pastes into a selection and copies edits on a narrow screen', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native clipboard permissions are granted in Chromium.');

  const prefix = '確認用の文章です。';
  const replaced = '差し替える部分';
  const suffix = '\n\n後半。';
  const pasted = `\n<em>文字のまま表示</em>\n${'long-unbroken-text'.repeat(20)}`;
  await page.setViewportSize({ width: 375, height: 812 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const input = page.getByRole('textbox', { name: '文章', exact: true });
  await input.focus();
  await page.keyboard.insertText(`${prefix}${replaced}${suffix}`);
  await expect(input).toHaveValue(`${prefix}${replaced}${suffix}`);

  await input.evaluate((element, [start, end]) => element.setSelectionRange(start, end), [prefix.length, prefix.length + replaced.length]);
  await page.evaluate(text => navigator.clipboard.writeText(text), pasted);
  await page.keyboard.press('ControlOrMeta+V');
  await expect(input).toHaveValue(`${prefix}${pasted}${suffix}`);
  await page.keyboard.insertText('追記');
  const edited = `${prefix}${pasted}追記${suffix}`;
  await expect(input).toHaveValue(edited);
  await expect(input).toHaveCSS('font-size', '26px');
  expect(await input.evaluate(element => element.scrollWidth)).toBe(await input.evaluate(element => element.clientWidth));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);

  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(edited);
});

test('pastes from the page, opens at the top, and supports native Undo and typing', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native clipboard permissions are granted in Chromium.');

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const input = page.getByRole('textbox');
  await input.blur();
  const source = '長い文章を先頭から読みます。\n'.repeat(100);
  await page.evaluate(text => navigator.clipboard.writeText(text), source);
  await page.keyboard.press('ControlOrMeta+V');

  await expect(input).toHaveValue(source);
  await expect(input).toBeFocused();
  await expect.poll(() => input.evaluate(element => [window.scrollY, element.scrollTop])).toEqual([0, 0]);

  await input.press('ControlOrMeta+Z');
  await expect(input).toHaveValue('');

  await input.press('ControlOrMeta+V');
  await expect(input).toHaveValue(source);
  await expect.poll(() => input.evaluate(element => element.scrollTop)).toBe(0);
  await page.keyboard.insertText('追記');
  await expect(input).toHaveValue(`${source}追記`);

  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await input.blur();
  await page.keyboard.press('Shift+Insert');
  await expect(input).toHaveValue(source);
});

test('forgets edits in a new tab, after reload and after history traversal', async ({ page, context, browserName }) => {
  await page.addInitScript(() => {
    window.historyRestores = 0;
    window.addEventListener('pageshow', event => {
      if (event.persisted) window.historyRestores++;
    });
  });
  await page.goto('/');
  const input = page.getByRole('textbox');
  const source = '開き直すと消える文章';
  const returnFromAnotherPage = async (historyRestores) => {
    await page.goto('/?away');
    await page.goBack({ waitUntil: 'commit' });
    await expect(input).toHaveValue('');
    if (browserName === 'chromium') {
      await expect.poll(() => page.evaluate(() => window.historyRestores)).toBe(historyRestores);
    }
  };

  await input.focus();
  await page.keyboard.insertText(source);
  await expect(input).toHaveValue(source);

  const newTab = await context.newPage();
  await newTab.goto(page.url());
  await expect(newTab.getByRole('textbox')).toHaveValue('');
  await newTab.close();

  await page.reload();
  await expect(input).toHaveValue('');

  await input.focus();
  await page.keyboard.insertText(source);
  let expected = source;
  if (browserName === 'chromium') {
    const pasted = '貼り付けた段落';
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(text => navigator.clipboard.writeText(text), pasted);
    await input.press('ControlOrMeta+V');
    expected += pasted;
  }
  await expect(input).toHaveValue(expected);
  await returnFromAnotherPage(1);

  // An empty field can still retain text in the browser's native undo history.
  await input.focus();
  await page.keyboard.insertText(source);
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await expect(input).toHaveValue('');
  await returnFromAnotherPage(2);
  await input.press('ControlOrMeta+Z');
  await expect(input).toHaveValue('');
});
