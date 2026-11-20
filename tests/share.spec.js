const { deflateRawSync } = require('node:zlib');
const { expect, test } = require('@playwright/test');

test('copies a share link that independently restores the exact text and leaves no draft after reload', async ({ browser, page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native clipboard permissions are granted in Chromium.');

  const paragraph = '  確認用の文章です。\n\n<em>文字のまま</em>\t🍵 e\u0301\n';
  const source = `${paragraph.repeat(20)} 末尾の空白  \n`;
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const cleanURL = page.url();
  const input = page.getByRole('textbox', { name: '文章', exact: true });
  const share = page.getByRole('button', { name: 'リンクをコピー' });
  await expect(share).toBeHidden();
  await input.fill(source);
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await share.click();
  await expect(page.getByRole('status')).toContainText('コピーしました');

  const link = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(link.hash).toMatch(/^#v1=[A-Za-z0-9_-]+$/);
  expect(link.hash.length).toBeLessThan(Buffer.byteLength(source, 'utf8'));
  const sharedURL = link.href;
  link.hash = '';
  expect(link.href).toBe(cleanURL);

  for (let recipient = 0; recipient < 2; recipient++) {
    const reader = await browser.newPage();
    try {
      await reader.goto(sharedURL);
      const readerInput = reader.getByRole('textbox', { name: '文章', exact: true });
      await expect(readerInput).toHaveValue(source);
      await expect(reader).toHaveURL(cleanURL);
      await reader.reload();
      await expect(readerInput).toHaveValue('');
    } finally {
      await reader.close();
    }
  }
});

test('opens external raw-deflate links and leaves malformed links blank', async ({ page }) => {
  const source = '  改行や空白を含む文章\n\n🌱\t続き  \n';
  const payload = deflateRawSync(Buffer.from(source, 'utf8')).toString('base64url');
  await page.goto(`/#v1=${payload}`);
  const input = page.getByRole('textbox', { name: '文章', exact: true });
  await expect(input).toHaveValue(source);
  await expect(page).toHaveURL(url => !url.hash);

  // _w decodes to a reserved DEFLATE block type.
  await page.goto('/?invalid#v1=_w');
  await expect(input).toHaveValue('');
  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.getByRole('status')).not.toBeEmpty();
});

test('clears a consumed share when Back stays in the same document', async ({ page }) => {
  const source = '同じタブで開いた文章';
  const payload = deflateRawSync(Buffer.from(source, 'utf8')).toString('base64url');
  await page.goto('/');
  const cleanURL = page.url();
  const input = page.getByRole('textbox', { name: '文章', exact: true });
  await input.click();
  await page.evaluate(hash => { location.hash = hash; }, `v1=${payload}`);
  await expect(input).toHaveValue(source);
  await expect(page).toHaveURL(cleanURL);
  await page.evaluate(() => history.back());
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'リンクをコピー' })).toBeHidden();
});

test('does not copy a stale draft while compression is pending', async ({ page }) => {
  let releaseCodec;
  const codecPaused = new Promise(resolve => { releaseCodec = resolve; });
  await page.route('**/share-codec.js', async route => {
    await codecPaused;
    await route.continue();
  });
  await page.addInitScript(() => {
    window.clipboardWrites = { started: 0, copied: [] };
    navigator.clipboard.write = async ([item]) => {
      window.clipboardWrites.started++;
      const blob = await item.getType('text/plain');
      window.clipboardWrites.copied.push(await blob.text());
    };
  });

  await page.goto('/');
  const input = page.getByRole('textbox', { name: '文章', exact: true });
  const share = page.getByRole('button', { name: 'リンクをコピー' });
  try {
    await input.fill('最初の本文');
    await share.click();
    await expect(share).toBeDisabled();
    await share.evaluate(button => button.click());
    expect(await page.evaluate(() => window.clipboardWrites.started)).toBe(1);
    await input.fill('共有したい本文');
  } finally {
    releaseCodec();
  }

  await expect(share).toBeEnabled();
  expect(await page.evaluate(() => window.clipboardWrites.copied)).toEqual([]);
  await share.click();
  await expect(page.getByRole('status')).toHaveText('リンクをコピーしました');
  const [link] = await page.evaluate(() => window.clipboardWrites.copied);
  await input.fill('別の本文');
  await page.goto(link);
  await expect(input).toHaveValue('共有したい本文');
});
