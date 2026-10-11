/* ==========================================================================
   backend/src/security.js
   Shared security helpers: CORS, JSON responses, HMAC (Web Crypto),
   constant-time comparison, token generation, rate limiting, input hygiene.

   NOTE: Cloudflare Workers do NOT have Node's `crypto` module. Everything
   here uses the standard Web Crypto API (globalThis.crypto.subtle).
   ========================================================================== */

/* ---- Config constants -------------------------------------------------- */

/* ₹1,449 in paise. The ONLY place the price is defined server-side.
   Never accept an amount from the browser. */
export const EXPECTED_AMOUNT_PAISE = 144900;
export const EXPECTED_CURRENCY = 'INR';

/* ---- Responses --------------------------------------------------------- */

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers
    }
  });
}

export function ok(data, headers) {
  return json({ ok: true, ...data }, 200, headers);
}

export function fail(message, status = 400, extra = {}, headers) {
  return json({ ok: false, error: extra.error || 'request_failed', message, ...extra }, status, headers);
}

/* ---- CORS -------------------------------------------------------------- */
/* ALLOWED_ORIGINS is a comma-separated list in wrangler.toml [vars].
   Only those exact origins receive an Access-Control-Allow-Origin header. */

export function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const list = allowedOrigins(env);
  const headers = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (origin && list.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function handlePreflight(request, env) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

/* Reject a state-changing request whose Origin is not allow-listed.
   (Requests with no Origin header are allowed: those are server-to-server
   calls such as the Razorpay webhook, which is authenticated by HMAC.) */
export function originAllowed(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  return allowedOrigins(env).includes(origin);
}

/* ---- Crypto ------------------------------------------------------------ */

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function randomHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(message)));
  return toHex(sig);
}

/* Constant-time string comparison — avoids leaking information through the
   time taken to compare signatures. */
export function safeEqual(a, b) {
  const s1 = String(a == null ? '' : a);
  const s2 = String(b == null ? '' : b);
  if (s1.length !== s2.length) return false;
  let diff = 0;
  for (let i = 0; i < s1.length; i++) {
    diff |= s1.charCodeAt(i) ^ s2.charCodeAt(i);
  }
  return diff === 0;
}

/* ---- Input hygiene ----------------------------------------------------- */

export function sanitizeEmail(value) {
  const email = String(value == null ? '' : value).trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  /* One @, at least one dot in the domain, no whitespace. */
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

export function sanitizeText(value, maxLength = 120) {
  const text = String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim();
  return text.slice(0, maxLength);
}

export function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    'unknown'
  ).split(',')[0].trim();
}

/* ---- Rate limiting (D1-backed) ---------------------------------------- */
/* A simple fixed-window counter. Keyed by bucket + client IP.
   Returns { allowed: boolean, remaining: number, retryAfterSeconds: number } */

export async function rateLimit(env, request, bucket, limit, windowMs) {
  const ip = clientIp(request);
  const key = `${bucket}:${ip}`;
  const now = Date.now();

  try {
    const row = await env.DB
      .prepare('SELECT count, window_start FROM rate_limits WHERE bucket = ?')
      .bind(key)
      .first();

    if (!row || now - Number(row.window_start) > windowMs) {
      await env.DB
        .prepare(
          `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?)
           ON CONFLICT(bucket) DO UPDATE SET count = 1, window_start = excluded.window_start`
        )
        .bind(key, now)
        .run();
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    const count = Number(row.count) + 1;
    await env.DB
      .prepare('UPDATE rate_limits SET count = ? WHERE bucket = ?')
      .bind(count, key)
      .run();

    if (count > limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((Number(row.window_start) + windowMs - now) / 1000)
      );
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
  } catch (err) {
    /* If the limiter itself fails we fail OPEN (do not block real customers)
       but log it. Payment verification still protects the business. */
    console.warn('rate_limit_unavailable', bucket, err && err.message);
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

export function rateLimitResponse(retryAfterSeconds, headers) {
  return json(
    {
      ok: false,
      error: 'rate_limited',
      message: 'Too many requests. Please wait a moment and try again.'
    },
    429,
    { 'Retry-After': String(retryAfterSeconds), ...headers }
  );
}

/* ---- Logging ----------------------------------------------------------- */
/* Log identifiers only. NEVER log signatures, secrets, card data or
   full email addresses. */

export function logEvent(event, details = {}) {
  console.log(
    JSON.stringify({
      event,
      ts: new Date().toISOString(),
      ...details
    })
  );
}
