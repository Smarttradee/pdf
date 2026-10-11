/* ==========================================================================
   backend/src/razorpay.js
   Razorpay REST API client + signature verification, using only fetch and
   the Web Crypto API (available in Cloudflare Workers).

   Official flows implemented:
   - Create an order            POST https://api.razorpay.com/v1/orders
   - Fetch a payment            GET  https://api.razorpay.com/v1/payments/:id
   - Checkout payment signature HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET)
   - Webhook signature          HMAC_SHA256(raw_request_body, WEBHOOK_SECRET)
                                delivered in the X-Razorpay-Signature header
   Docs: https://razorpay.com/docs/api/orders/
         https://razorpay.com/docs/webhooks/validate-test/
   ========================================================================== */

import { hmacSha256Hex, safeEqual, EXPECTED_AMOUNT_PAISE, EXPECTED_CURRENCY } from './security.js';

const API_BASE = 'https://api.razorpay.com/v1';

/* ---- Auth -------------------------------------------------------------- */

function requireKeyId(env) {
  if (!env.RAZORPAY_KEY_ID) throw new Error('RAZORPAY_KEY_ID is not configured');
  return env.RAZORPAY_KEY_ID;
}

function requireKeySecret(env) {
  if (!env.RAZORPAY_KEY_SECRET) throw new Error('RAZORPAY_KEY_SECRET is not configured');
  return env.RAZORPAY_KEY_SECRET;
}

function basicAuthHeader(env) {
  const raw = `${requireKeyId(env)}:${requireKeySecret(env)}`;
  return 'Basic ' + btoa(raw);
}

async function rzpFetch(env, path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: basicAuthHeader(env),
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      (data && data.error && data.error.description) || `Razorpay API error (${res.status})`
    );
    err.status = res.status;
    err.razorpay = data;
    throw err;
  }
  return data;
}

/* ---- Orders ------------------------------------------------------------ */

/**
 * Create an order with the price fixed on the server.
 * The amount can NEVER come from the browser.
 */
export async function createOrder(env, { receipt, email, name, phone, orderNotes = {} }) {
  const amount = EXPECTED_AMOUNT_PAISE;

  const body = {
    amount,
    currency: EXPECTED_CURRENCY,
    receipt: String(receipt).slice(0, 40),
    /* auto-capture: the payment settles straight to `captured`. */
    payment_capture: 1,
    notes: {
      product: 'claude-ai-video-editing-course',
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      ...orderNotes
    }
  };

  return rzpFetch(env, '/orders', { method: 'POST', body: JSON.stringify(body) });
}

/* ---- Payments ---------------------------------------------------------- */

export async function fetchPayment(env, paymentId) {
  return rzpFetch(env, `/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' });
}

/* ---- Verification ------------------------------------------------------ */

/**
 * Verify the Standard Checkout payment signature.
 * Razorpay signs `${order_id}|${payment_id}` with your KEY SECRET.
 * If this does not match, the request did not come from Razorpay.
 */
export async function verifyPaymentSignature(env, { orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;
  const expected = await hmacSha256Hex(requireKeySecret(env), `${orderId}|${paymentId}`);
  return safeEqual(expected, signature);
}

/**
 * Verify a webhook signature.
 * `rawBody` MUST be the untouched request body string — parsing and
 * re-serialising the JSON will break the signature.
 * The signature arrives in the X-Razorpay-Signature header.
 */
export async function verifyWebhookSignature(env, rawBody, signatureHeader) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET is not configured');
  }
  if (!signatureHeader) return false;
  const expected = await hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, rawBody);
  return safeEqual(expected, signatureHeader);
}

/**
 * Confirm with Razorpay that a payment is genuinely captured and that the
 * amount and currency match our fixed price.
 * Returns { valid, reason, payment }
 */
export async function assertCapturedPayment(env, { orderId, paymentId }) {
  const payment = await fetchPayment(env, paymentId);

  if (!payment) {
    return { valid: false, reason: 'payment_not_found', payment: null };
  }
  if (payment.order_id !== orderId) {
    return { valid: false, reason: 'order_mismatch', payment };
  }
  if (payment.status !== 'captured') {
    /* authorized / created / failed / refunded are NOT deliverable states. */
    return { valid: false, reason: `payment_not_captured:${payment.status}`, payment };
  }
  if (Number(payment.amount) !== EXPECTED_AMOUNT_PAISE) {
    return { valid: false, reason: 'amount_mismatch', payment };
  }
  if (String(payment.currency) !== EXPECTED_CURRENCY) {
    return { valid: false, reason: 'currency_mismatch', payment };
  }
  return { valid: true, reason: 'ok', payment };
}
