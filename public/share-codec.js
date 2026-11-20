const maxTextBytes = 2 * 1024 * 1024;
const maxLegacyPayloadLength = 64_000;
const maxWireBytes = maxTextBytes + 2048;
const issuedAtBytes = 4;
const minIssuedAt = 1_000_000_000;
const keyBytes = 16;
const ivBytes = 12;
const tagBits = 128;

export class ShareNotFoundError extends Error {}

function encodeBase64Url(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value) {
  if (!value || /[^A-Za-z0-9_-]/.test(value)) throw new TypeError('Invalid share link');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function shareId(rawKey) {
  const hash = await crypto.subtle.digest('SHA-256', rawKey);
  return encodeBase64Url(new Uint8Array(hash));
}

async function compressText(text) {
  const source = new Blob([text]);
  if (source.size > maxTextBytes) throw new RangeError('Shared text is too large');
  const compressed = source.stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Response(compressed).arrayBuffer();
}

async function decompressText(bytes) {
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

// Older open tabs can lazily import this module after a deployment.
export async function encodeSharedText(text) {
  const bytes = new Uint8Array(await compressText(text));
  if (Math.ceil(bytes.length * 4 / 3) > maxLegacyPayloadLength) throw new RangeError('Share link is too long');
  return encodeBase64Url(bytes);
}

export async function decodeSharedText(payload) {
  if (payload.length > maxLegacyPayloadLength) throw new RangeError('Share link is too long');
  return decompressText(decodeBase64Url(payload));
}

export async function createShortShare(text, signal) {
  signal?.throwIfAborted();
  const rawKey = crypto.getRandomValues(new Uint8Array(keyBytes));
  const iv = crypto.getRandomValues(new Uint8Array(ivBytes));
  const [id, key, compressed] = await Promise.all([
    shareId(rawKey),
    crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']),
    compressText(text),
  ]);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: tagBits }, key, compressed);
  const wire = new Uint8Array(ivBytes + ciphertext.byteLength);
  wire.set(iv);
  wire.set(new Uint8Array(ciphertext), ivBytes);

  const response = await fetch(`/api/share/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: wire,
    signal,
    redirect: 'error',
  });
  if (response.status !== 201) throw new Error('Could not create share');
  const timestamp = new TextDecoder().decode(await readBoundedBody(response, 10));
  const issuedAt = Number(timestamp);
  if (!/^[1-9][0-9]{9}$/.test(timestamp) || issuedAt > 0xffffffff) throw new TypeError('Invalid share time');

  const token = new Uint8Array(issuedAtBytes + keyBytes);
  new DataView(token.buffer).setUint32(0, issuedAt);
  token.set(rawKey, issuedAtBytes);
  return encodeBase64Url(token);
}

async function readBoundedBody(response, limit) {
  if (!response.body) throw new TypeError('Invalid share data');
  let size = 0;
  const boundedBody = response.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) throw new TypeError('Invalid share data');
      controller.enqueue(chunk);
    },
  }));
  return new Uint8Array(await new Response(boundedBody).arrayBuffer());
}

export async function openShortShare(token, signal) {
  if (token.length !== 27) throw new TypeError('Invalid share link');
  const tokenBytes = decodeBase64Url(token);
  if (encodeBase64Url(tokenBytes) !== token) throw new TypeError('Invalid share link');
  const issuedAt = new DataView(tokenBytes.buffer).getUint32(0);
  if (issuedAt < minIssuedAt) throw new TypeError('Invalid share time');
  const rawKey = tokenBytes.subarray(issuedAtBytes);

  const id = await shareId(rawKey);
  const response = await fetch(`/api/share/${issuedAt}/${id}`, { signal, cache: 'no-store', redirect: 'error' });
  if (response.status === 404) throw new ShareNotFoundError('Share expired or not found');
  if (response.status !== 200) throw new Error('Could not open share');

  const wire = await readBoundedBody(response, maxWireBytes);
  if (wire.length < ivBytes + tagBits / 8) throw new TypeError('Invalid share data');
  signal?.throwIfAborted();
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const compressed = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: wire.subarray(0, ivBytes), tagLength: tagBits },
    key,
    wire.subarray(ivBytes),
  );
  return decompressText(new Uint8Array(compressed));
}
