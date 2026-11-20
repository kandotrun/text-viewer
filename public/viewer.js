let editor = document.querySelector('#text');
const share = document.querySelector('#share');
const shareLink = document.querySelector('#share-link');
const shareStatus = document.querySelector('#share-status');
const copyLink = document.querySelector('#copy-link');
const sharePrefix = '#s1=';
const legacySharePrefix = '#v1=';
let revision = 0;
let shareRequest;

function invalidateShare() {
  shareRequest?.abort();
  shareRequest = undefined;
  return ++revision;
}

function prefixFor(hash) {
  return [sharePrefix, legacySharePrefix].find(prefix => hash.startsWith(prefix));
}

function updateShare(message = '', url = '') {
  copyLink.hidden = editor.value === '';
  shareStatus.textContent = message;
  shareLink.value = url;
  shareLink.hidden = !url;
  share.hidden = copyLink.hidden && !message;
}

async function createShareLink(text, signal) {
  const { createShortShare } = await import('./share-codec.js');
  const url = new URL(location.href);
  url.search = '';
  url.hash = sharePrefix + await createShortShare(text, signal);
  return url.href;
}

async function copyToClipboard(url, attempt) {
  if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function') return false;
  try {
    // Start the clipboard write during the click, even while compression is pending.
    const content = url.then(link => {
      if (attempt !== revision) throw new DOMException('The draft changed', 'AbortError');
      return new Blob([link], { type: 'text/plain' });
    });
    // A denied clipboard write may leave its data promise unread.
    void content.catch(() => {});
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': content })]);
    return true;
  } catch {
    return false;
  }
}

copyLink.addEventListener('click', async () => {
  if (copyLink.disabled) return;
  copyLink.disabled = true;
  const attempt = invalidateShare();
  const request = new AbortController();
  shareRequest = request;
  const url = createShareLink(editor.value, request.signal);
  const writing = copyToClipboard(url, attempt);
  try {
    const [link, copied] = await Promise.all([url, writing]);
    if (attempt !== revision) return;
    if (copied) {
      updateShare('リンクをコピーしました（7日間有効）');
    } else {
      updateShare('共有リンクを選択してコピーしてください（7日間有効）', link);
      shareLink.focus();
      shareLink.select();
    }
  } catch (error) {
    if (attempt !== revision) return;
    updateShare(error instanceof RangeError
      ? '文章が長いため、共有リンクを作れませんでした'
      : '共有リンクを作れませんでした');
  } finally {
    await writing;
    if (shareRequest === request) shareRequest = undefined;
    copyLink.disabled = false;
  }
});

async function openShareLink() {
  const attempt = invalidateShare();
  const hash = location.hash;
  const prefix = prefixFor(hash);
  if (!prefix) return;

  const request = new AbortController();
  shareRequest = request;
  let codec;

  try {
    const address = new URL(location.href);
    address.hash = '';
    history.replaceState({ consumedShare: attempt }, '', address);
    codec = await import('./share-codec.js');
    const payload = hash.slice(prefix.length);
    const text = prefix === sharePrefix
      ? await codec.openShortShare(payload, request.signal)
      : await codec.decodeSharedText(payload);
    if (attempt !== revision) return;
    editor.value = text;
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    updateShare();
  } catch (error) {
    if (attempt !== revision) return;
    updateShare(codec && error instanceof codec.ShareNotFoundError
      ? '共有リンクの有効期限が切れたか、見つかりません'
      : '共有リンクを開けませんでした');
  } finally {
    if (shareRequest === request) shareRequest = undefined;
  }
}

document.addEventListener('input', (event) => {
  if (event.target !== editor) return;
  invalidateShare();
  updateShare();
});

// Focus before the browser handles the shortcut so paste and Undo stay native.
document.addEventListener('keydown', (event) => {
  if (event.target === editor || event.target === shareLink || event.defaultPrevented || event.altKey) return;
  const pasteShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v';
  const insertShortcut = event.shiftKey && event.key === 'Insert' && !event.ctrlKey && !event.metaKey;
  if (pasteShortcut || insertShortcut) {
    editor.focus({ preventScroll: true });
  }
});

document.addEventListener('paste', (event) => {
  const input = editor;
  if (event.target !== input || input.value !== '' || event.defaultPrevented) return;
  requestAnimationFrame(() => { input.scrollTop = 0; });
});

// Drop the textarea's native undo history as well as the value.
function clearEditor() {
  invalidateShare();
  editor.value = '';
  const blankEditor = editor.cloneNode();
  editor.replaceWith(blankEditor);
  editor = blankEditor;
  updateShare();
}

window.addEventListener('pagehide', clearEditor);
window.addEventListener('popstate', () => {
  if (!prefixFor(location.hash)) clearEditor();
});
window.addEventListener('pageshow', () => {
  editor.value = '';
  updateShare();
  void openShareLink();
});
window.addEventListener('hashchange', openShareLink);
editor.value = '';
