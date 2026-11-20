const input = document.querySelector('#text');
const reading = document.querySelector('#reading');

function clearText() {
  input.value = '';
  input.hidden = false;
  reading.textContent = '';
  reading.hidden = true;
}

document.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text/plain');
  if (!text || event.defaultPrevented) return;

  event.preventDefault();
  input.value = '';
  input.hidden = true;
  reading.textContent = text;
  reading.hidden = false;
  reading.focus({ preventScroll: true });
  window.scrollTo(0, 0);
});

// Discard text before a browser can restore the page from its history cache.
window.addEventListener('pagehide', clearText);
window.addEventListener('pageshow', clearText);
clearText();
