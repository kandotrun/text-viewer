import { DurableObject } from 'cloudflare:workers';

const sharePath = /^\/api\/share\/(?:([1-9][0-9]{0,9})\/)?([A-Za-z0-9_-]{43})$/;
const envelopeType = 'application/octet-stream';
const minBodyBytes = 30;
const maxBodyBytes = 2 * 1024 * 1024 + 2048;
const lifetimeMs = 7 * 24 * 60 * 60 * 1000;

function apiResponse(status, body = null, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

async function readEnvelope(request) {
  if (Number(request.headers.get('Content-Length')) > maxBodyBytes) return null;
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBodyBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export class ShortShare extends DurableObject {
  async create(body, issuedAt) {
    const { storage } = this.ctx;
    if (await storage.get('share')) return false;

    const expiresAt = issuedAt * 1000 + lifetimeMs;
    // Consecutive storage writes share one atomic commit under the output gate.
    await Promise.all([
      storage.put('share', { body, expiresAt }),
      storage.setAlarm(expiresAt),
    ]);
    return true;
  }

  async read() {
    const share = await this.ctx.storage.get('share');
    return share && share.expiresAt > Date.now() ? share.body : null;
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = sharePath.exec(url.pathname);
    if (!match) {
      if (url.pathname === '/api/share' || url.pathname.startsWith('/api/share/')) {
        return apiResponse(404);
      }
      return env.ASSETS.fetch(request);
    }

    const { method } = request;
    const [, timestamp, id] = match;
    if (method === 'GET' && !timestamp) return apiResponse(404);
    const allowedMethod = timestamp ? 'GET' : 'POST';
    if (method !== allowedMethod) return apiResponse(405, null, { Allow: allowedMethod });

    if (method === 'GET') {
      const createdAt = Number(timestamp) * 1000;
      const now = Date.now();
      if (createdAt > now || createdAt + lifetimeMs <= now) return apiResponse(404);
    } else {
      if (request.headers.get('Origin') !== url.origin) return apiResponse(403);
      if (request.headers.get('Content-Type') !== envelopeType) return apiResponse(415);
    }

    try {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
      const { success } = await env.SHARE_RATE_LIMIT.limit({ key: `${method}:${ip}` });
      if (!success) return apiResponse(429);

      if (method === 'GET') {
        const body = await env.SHARES.getByName(`${timestamp}/${id}`).read();
        return body === null ? apiResponse(404) : apiResponse(200, body, { 'Content-Type': envelopeType });
      }

      const body = await readEnvelope(request);
      if (body === null) return apiResponse(413);
      if (body.byteLength < minBodyBytes) return apiResponse(400);

      const issuedAt = Math.floor(Date.now() / 1000);
      const share = env.SHARES.getByName(`${issuedAt}/${id}`);
      if (!await share.create(body, issuedAt)) return apiResponse(409);
      return apiResponse(201, String(issuedAt), { 'Content-Type': 'text/plain; charset=utf-8' });
    } catch {
      return apiResponse(503);
    }
  },
};
