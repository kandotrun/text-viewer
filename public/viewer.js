let editor = document.querySelector('#text');

// Focus before the browser handles the shortcut so paste and Undo stay native.
document.addEventListener('keydown', (event) => {
  if (event.target === editor || event.defaultPrevented || event.altKey) return;
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

// Drop the native undo history as well as the value before history caching.
window.addEventListener('pagehide', () => {
  editor.value = '';
  const blankEditor = editor.cloneNode();
  editor.replaceWith(blankEditor);
  editor = blankEditor;
});
window.addEventListener('pageshow', () => { editor.value = ''; });
editor.value = '';
