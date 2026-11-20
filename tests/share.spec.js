const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');
const { deflateRawSync, inflateRawSync } = require('node:zlib');
const { expect, test } = require('@playwright/test');

function shareId(key) {
  return createHash('sha256').update(key).digest('base64url');
}

function shareToken(issuedAt, key) {
  const token = Buffer.alloc(20);
  token.writeUInt32BE(issuedAt);
  key.copy(token, 4);
  return token.toString('base64url');
}

test('copies a short encrypted link that independently restores the exact long text', async ({ browser, page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native clipboard permissions are granted in Chromium.');

  const literal = '<em>文字のまま</em>\t🍵 e\u0301';
  const paragraphs = Array.from({ length: 180 }, (_, index) => {
    const mixedText = createHash('sha256').update(String(index)).digest('hex');
    return `  確認用の文章 ${index + 1}。\n\n${literal} ${mixedText}\n`;
  });
  const source = `${paragraphs.join('\n')} 末尾の空白  \n`;
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const cleanURL = page.url();
  const input = page.getByRole('textbox', { name: '文章', exact: true });
  const share = page.getByRole('button', { name: 'リンクをコピー' });
  await expect(share).toBeHidden();
  await input.fill(source);
  await page.evaluate(() => navigator.clipboard.writeText(''));
  const uploadRequest = page.waitForRequest(request => request.method() === 'POST' && request.url().includes('/api/share/'));
  await share.click();
  await expect(page.getByRole('status')).toHaveText('リンクをコピーしました（7日間有効）');

  const link = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(link.hash).toMatch(/^#s1=[A-Za-z0-9_-]{27}$/);
  const token = Buffer.from(link.hash.slice('#s1='.length), 'base64url');
  expect(token).toHaveLength(20);
  const issuedAt = token.readUInt32BE();
  const key = token.subarray(4);
  const sharedURL = link.href;
  if (link.origin === 'https://viewer.2-38.com') expect(sharedURL).toHaveLength(55);
  link.hash = '';
  expect(link.href).toBe(cleanURL);

  const upload = await uploadRequest;
  const id = shareId(key);
  const uploadURL = new URL(`/api/share/${id}`, cleanURL).href;
  const downloadURL = new URL(`/api/share/${issuedAt}/${id}`, cleanURL).href;
  expect(upload.url()).toBe(uploadURL);
  const uploadResponse = await upload.response();
  expect(uploadResponse.status()).toBe(201);
  expect(await uploadResponse.text()).toBe(String(issuedAt));
  const wire = upload.postDataBuffer();
  expect(wire.includes(key)).toBe(false);
  expect(wire.includes(Buffer.from(literal, 'utf8'))).toBe(false);
  const decipher = createDecipheriv('aes-128-gcm', key, wire.subarray(0, 12));
  decipher.setAuthTag(wire.subarray(-16));
  const compressed = Buffer.concat([decipher.update(wire.subarray(12, -16)), decipher.final()]);
  expect(inflateRawSync(compressed).toString('utf8')).toBe(source);

  for (let recipient = 0; recipient < 2; recipient++) {
    const reader = await browser.newPage();
    try {
      const download = reader.waitForResponse(response => response.url() === downloadURL && response.request().method() === 'GET');
      await reader.goto(sharedURL);
      const readerInput = reader.getByRole('textbox', { name: '文章', exact: true });
      await expect(readerInput).toHaveValue(source);
      expect((await download).status()).toBe(200);
      await expect(reader).toHaveURL(cleanURL);
      await reader.reload();
      await expect(readerInput).toHaveValue('');
    } finally {
      await reader.close();
    }
  }

  const expiredAt = issuedAt - 7 * 24 * 60 * 60 - 60;
  expect((await context.request.get(`/api/share/${expiredAt}/${id}`)).status()).toBe(404);
});

test('leaves a missing short link blank and reports its expiry or absence', async ({ page }) => {
  const key = randomBytes(16);
  const issuedAt = Math.floor(Date.now() / 1000);
  const path = `/api/share/${issuedAt}/${shareId(key)}`;
  const missing = page.waitForResponse(response => new URL(response.url()).pathname === path);
  await page.goto(`/#s1=${shareToken(issuedAt, key)}`);
  expect((await missing).status()).toBe(404);
  await expect(page.getByRole('textbox', { name: '文章', exact: true })).toHaveValue('');
  await expect(page.getByRole('status')).toHaveText('共有リンクの有効期限が切れたか、見つかりません');
  await expect(page).toHaveURL(url => !url.hash);
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

test('clears a consumed short share when Back stays in the same document', async ({ page, request }) => {
  const source = '同じタブで開いた文章';
  const key = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-128-gcm', key, iv);
  const encrypted = cipher.update(deflateRawSync(Buffer.from(source, 'utf8')));
  const wire = Buffer.concat([iv, encrypted, cipher.final(), cipher.getAuthTag()]);
  await page.goto('/');
  const cleanURL = page.url();
  const upload = await request.post(`/api/share/${shareId(key)}`, {
    headers: { Origin: new URL(cleanURL).origin, 'Content-Type': 'application/octet-stream' },
    data: wire,
  });
  expect(upload.status()).toBe(201);
  const issuedAt = Number(await upload.text());
  const input = page.getByRole('textbox', { name: '文章', exact: true });
  await input.click();
  await page.evaluate(hash => { location.hash = hash; }, `s1=${shareToken(issuedAt, key)}`);
  await expect(input).toHaveValue(source);
  await expect(page).toHaveURL(cleanURL);
  await page.evaluate(() => history.back());
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'リンクをコピー' })).toBeHidden();
});

test('does not upload or copy a stale draft while the share module is pending', async ({ page }) => {
  const uploads = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('/api/share/')) uploads.push(request.url());
  });
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
  expect(uploads).toEqual([]);
  expect(await page.evaluate(() => window.clipboardWrites.copied)).toEqual([]);
  await share.click();
  await expect(page.getByRole('status')).toHaveText('リンクをコピーしました（7日間有効）');
  const [link] = await page.evaluate(() => window.clipboardWrites.copied);
  await input.fill('別の本文');
  await page.goto(link);
  await expect(input).toHaveValue('共有したい本文');
});
