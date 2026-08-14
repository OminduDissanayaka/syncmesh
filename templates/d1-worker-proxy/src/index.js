/**
 * @fileoverview D1 HTTP Proxy Worker — required only for SyncMesh's "d1" db provider.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 * Scaffolded by: npx syncmesh-init-d1-proxy
 *
 * Cloudflare D1 can only be queried through a Worker binding — there is
 * no direct TCP/HTTP protocol a Node.js app can speak to D1 on its own.
 * This Worker is that bridge: a small, Bearer-token-protected HTTP API in
 * front of the D1 binding, which SyncMesh's D1Adapter calls.
 *
 * Security model: designed for a single trusted caller (your app server),
 * authenticated via a shared secret (D1_PROXY_TOKEN). Not meant to be
 * exposed to end users or arbitrary clients.
 *
 * NOTE ON RATE LIMITING: this Worker has no built-in brute-force
 * throttling for D1_PROXY_TOKEN guesses — it relies on Cloudflare's
 * edge-level DDoS/abuse protections. For a higher-security deployment,
 * add a Cloudflare Rate Limiting Rule on this route, or a KV-backed
 * per-IP counter, in front of the token check below.
 */

/**
 * Timing-safe check of the request's Bearer token against D1_PROXY_TOKEN.
 *
 * Follows Cloudflare's documented pattern (see
 * developers.cloudflare.com/workers/examples/protect-against-timing-attacks):
 * hash both values to a fixed size first with SHA-256, so a plain ===
 * (or an early length-mismatch return) never leaks how long the correct
 * token is or how many leading bytes a guess got right — then compare the
 * hashes with crypto.subtle.timingSafeEqual, a constant-time comparison
 * Cloudflare Workers expose as a non-standard Web Crypto extension.
 * @param {Request} request
 * @param {string} expectedToken
 * @returns {Promise<boolean>}
 */
async function isAuthorized(request, expectedToken) {
  const header = request.headers.get('Authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return false;

  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(token)),
    crypto.subtle.digest('SHA-256', encoder.encode(expectedToken)),
  ]);

  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

/**
 * @param {unknown} body
 * @param {number} [status]
 * @returns {Response}
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  /**
   * @param {Request} request
   * @param {{ DB: D1Database, D1_PROXY_TOKEN: string }} env
   */
  async fetch(request, env) {
    if (!(await isAuthorized(request, env.D1_PROXY_TOKEN))) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const url = new URL(request.url);

    if (url.pathname === '/ping') {
      return json({ message: 'D1 proxy is awake.' });
    }

    // Body: { "sql": "SELECT * FROM chat_archive_chunks WHERE room_id = ?", "params": ["room123"] }
    if (url.pathname === '/query' && request.method === 'POST') {
      try {
        const { sql, params = [] } = await request.json();
        if (!sql || typeof sql !== 'string') {
          return json({ error: 'Missing or invalid "sql" field' }, 400);
        }

        const stmt = env.DB.prepare(sql).bind(...params);
        const isWrite = /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i.test(sql);
        const result = isWrite ? await stmt.run() : await stmt.all();

        return json({ result });
      } catch (error) {
        return json({ error: error.message }, 500);
      }
    }

    // Body: { "statements": [{ "sql": "...", "params": [...] }, ...] }
    if (url.pathname === '/batch' && request.method === 'POST') {
      try {
        const { statements = [] } = await request.json();
        const prepared = statements.map((s) => env.DB.prepare(s.sql).bind(...(s.params || [])));
        const results = await env.DB.batch(prepared);
        return json({ results });
      } catch (error) {
        return json({ error: error.message }, 500);
      }
    }

    return json({ error: 'Not found' }, 404);
  },
};
