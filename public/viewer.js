let editor = document.querySelector('#text');
const share = document.querySelector('#share');
const shareLink = document.querySelector('#share-link');
const shareStatus = document.querySelector('#share-status');
const copyLink = document.querySelector('#copy-link');
const sharePrefix = '#v1=';
let revision = 0;

function updateShare(message = '', url = '') {
  copyLink.hidden = editor.value === '';
  shareStatus.textContent = message;
  shareLink.value = url;
  shareLink.hidden = !url;
  share.hidden = copyLink.hidden && !message;
}

async function createShareLink(text) {
  const { encodeSharedText } = await import('./share-codec.js');
  const url = new URL(location.href);
  url.search = '';
  url.hash = sharePrefix + await encodeSharedText(text);
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
  const attempt = ++revision;
  const url = createShareLink(editor.value);
  const writing = copyToClipboard(url, attempt);
  try {
    const [link, copied] = await Promise.all([url, writing]);
    if (attempt !== revision) return;
    if (copied) {
      updateShare('リンクをコピーしました');
    } else {
      updateShare('共有リンクを選択してコピーしてください', link);
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
    copyLink.disabled = false;
  }
});

async function openShareLink() {
  const attempt = ++revision;
  const hash = location.hash;
  if (!hash.startsWith(sharePrefix)) return;

  try {
    const address = new URL(location.href);
    address.hash = '';
    history.replaceState({ consumedShare: attempt }, '', address);
    const { decodeSharedText } = await import('./share-codec.js');
    const text = await decodeSharedText(hash.slice(sharePrefix.length));
    if (attempt !== revision) return;
    editor.value = text;
    editor.setSelectionRange(0, 0);
    editor.scrollTop = 0;
    updateShare();
  } catch {
    if (attempt === revision) updateShare('共有リンクを開けませんでした');
  }
}

document.addEventListener('input', (event) => {
  if (event.target !== editor) return;
  revision++;
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
  revision++;
  editor.value = '';
  const blankEditor = editor.cloneNode();
  editor.replaceWith(blankEditor);
  editor = blankEditor;
  updateShare();
}

window.addEventListener('pagehide', clearEditor);
window.addEventListener('popstate', () => {
  if (!location.hash.startsWith(sharePrefix)) clearEditor();
});
window.addEventListener('pageshow', () => {
  editor.value = '';
  updateShare();
  void openShareLink();
});
window.addEventListener('hashchange', openShareLink);
editor.value = '';
