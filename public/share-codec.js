const maxTextBytes = 2 * 1024 * 1024;
const maxPayloadLength = 64_000;

export async function encodeSharedText(text) {
  const source = new Blob([text]);
  if (source.size > maxTextBytes) throw new RangeError('Shared text is too large');

  const compressed = source.stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  if (Math.ceil(bytes.length * 4 / 3) > maxPayloadLength) {
    throw new RangeError('Share link is too long');
  }

  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function decodeSharedText(payload) {
  if (payload.length > maxPayloadLength) throw new RangeError('Share link is too long');
  if (!payload || /[^A-Za-z0-9_-]/.test(payload)) throw new TypeError('Invalid share link');

  const binary = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  let offset = 0;
  // Read small compressed chunks so the inflater cannot produce the whole payload at once.
  const compressed = new ReadableStream({
    pull(controller) {
      controller.enqueue(bytes.subarray(offset, offset + 1024));
      offset += 1024;
      if (offset >= bytes.length) controller.close();
    },
  });
  const reader = compressed.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const pieces = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return pieces.join('') + decoder.decode();
      size += value.byteLength;
      if (size > maxTextBytes) throw new RangeError('Shared text is too large');
      pieces.push(decoder.decode(value, { stream: true }));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
