/* ==========================================================================
   backend/src/index.js — Cloudflare Worker API for the
   "Claude AI Video Editing Course" digital product.

   ROUTES
   POST /api/create-order     Create a Razorpay order (amount fixed: ₹1,449)
   POST /api/verify-payment   Verify signature + payment, then issue a token
   POST /api/webhook/razorpay Razorpay webhook (HMAC verified, idempotent)
   GET  /api/download?t=...   Single-use, expiring private PDF download
   POST /api/order-status     Status of an order (used by the pending page)
   POST /api/resend-link      Email a fresh download link (rate limited)
   GET  /api/health           Config sanity check (no secrets returned)

   SECURITY MODEL
   - A redirect or ?success=true is never proof of payment.
   - The amount lives on the server (EXPECTED_AMOUNT_PAISE = 144900).
   - Delivery requires a payment verified by signature AND confirmed captured
     through the Razorpay API, or a webhook whose HMAC we verified.
   - Download tokens are random, single-use, expiring and stored in D1.
   - No secret is ever returned to the browser.
   ========================================================================== */

import {
  EXPECTED_AMOUNT_PAISE,
  EXPECTED_CURRENCY,
  json,
  ok,
  fail,
  corsHeaders,
  handlePreflight,
  originAllowed,
  randomHex,
  sanitizeEmail,
  sanitizeText,
  rateLimit,
  rateLimitResponse,
  logEvent
} from './security.js';

import {
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  assertCapturedPayment,
  fetchPayment
} from './razorpay.js';

import { getPdf, headPdf, pdfResponse } from './storage.js';
import { sendDownloadEmail } from './email.js';

/* ---- Token / order helpers -------------------------------------------- */

function tokenTtlMs(env) {
  return Number(env.TOKEN_TTL_MINUTES || 60) * 60 * 1000;
}

function linkTtlMs(env) {
  return Number(env.DOWNLOAD_LINK_TTL_HOURS || 24) * 60 * 60 * 1000;
}

/** Create a short-lived, single-use download token in D1. */
async function issueToken(env, { orderId, paymentId, kind = 'email', ttlMs }) {
  const token = randomHex(32); // 256 bits of entropy
  const now = Date.now();
  const expiresAt = now + (ttlMs || tokenTtlMs(env));

  await env.DB.prepare(
    `INSERT INTO tokens (token, order_id, payment_id, kind, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`
  )
    .bind(token, orderId, paymentId, kind, expiresAt, now)
    .run();

  return { token, expiresAt };
}

/** URL on OUR site (never a public storage URL). */
function downloadPageUrl(env, orderId, token) {
  const base = String(env.PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  return `${base}/pages/success.html?order_id=${encodeURIComponent(orderId)}&t=${encodeURIComponent(token)}`;
}

/** Idempotent order upsert keyed on payment_id. */
async function recordOrder(env, data) {
  const now = Date.now();
  const existing = data.payment_id
    ? await env.DB.prepare('SELECT * FROM orders WHERE payment_id = ?')
        .bind(data.payment_id)
        .first()
    : null;

  if (existing) {
    await env.DB.prepare(
      `UPDATE orders SET
         status = ?,
         email = COALESCE(?, email),
         name = COALESCE(?, name),
         phone = COALESCE(?, phone),
         updated_at = ?
       WHERE payment_id = ?`
    )
      .bind(data.status, data.email, data.name, data.phone, now, data.payment_id)
      .run();
    return { ...existing, ...data, updated_at: now };
  }

  await env.DB.prepare(
    `INSERT INTO orders
       (order_id, payment_id, email, name, phone, amount, currency, status, source, email_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      data.order_id,
      data.payment_id,
      data.email,
      data.name,
      data.phone,
      data.amount,
      data.currency,
      data.status,
      data.source,
      'pending',
      now,
      now
    )
    .run();

  return { ...data, email_status: 'pending', created_at: now, updated_at: now };
}

async function markEmailStatus(env, paymentId, status, sentAt) {
  await env.DB.prepare(
    'UPDATE orders SET email_status = ?, email_sent_at = ?, updated_at = ? WHERE payment_id = ?'
  )
    .bind(status, sentAt || null, Date.now(), paymentId)
    .run();
}

/**
 * Issue a token and email it, unless this payment has already had a
 * successful email. Returns { emailed, emailStatus, token, expiresAt }.
 */
async function deliverByEmail(env, order, { force = false } = {}) {
  const ttl = linkTtlMs(env);
  const { token, expiresAt } = await issueToken(env, {
    orderId: order.order_id,
    paymentId: order.payment_id,
    kind: 'email',
    ttlMs: ttl
  });

  if (!order.email) {
    await markEmailStatus(env, order.payment_id, 'no_email');
    logEvent('email_skipped_no_address', { order_id: order.order_id });
    return { emailed: false, emailStatus: 'no_email', token, expiresAt };
  }

  if (!force && order.email_status === 'sent' && order.email_sent_at) {
    /* Already delivered once — do not spam. The token is still fresh and the
       customer keeps the link they already have. */
    logEvent('email_skipped_already_sent', { order_id: order.order_id });
    return { emailed: false, emailStatus: 'sent', token, expiresAt };
  }

  const result = await sendDownloadEmail(env, {
    to: order.email,
    name: order.name,
    downloadUrl: downloadPageUrl(env, order.order_id, token),
    orderId: order.order_id,
    paymentId: order.payment_id
  });

  const status = result.sent ? 'sent' : (result.reason || 'failed');
  await markEmailStatus(env, order.payment_id, status, result.sent ? Date.now() : null);
  return { emailed: result.sent, emailStatus: status, token, expiresAt };
}

/* ======================================================================
   ROUTE HANDLERS
   ====================================================================== */

/* POST /api/create-order ------------------------------------------------ */
async function handleCreateOrder(request, env, headers) {
  if (!originAllowed(request, env)) {
    return fail('This request origin is not allowed.', 403, { error: 'origin_not_allowed' }, headers);
  }

  const rl = await rateLimit(env, request, 'create-order', 15, 60 * 60 * 1000);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds, headers);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return fail('Invalid JSON body.', 400, { error: 'bad_json' }, headers);
  }

  const email = sanitizeEmail(body && body.email);
  const name = sanitizeText(body && body.name, 80);
  const phone = sanitizeText(body && body.phone, 20);

  if (!email) {
    return fail('A valid email address is required so we can send your download link.', 422, { error: 'invalid_email' }, headers);
  }

  try {
    const receipt = `rc_${Date.now().toString(36)}_${randomHex(4)}`.slice(0, 40);
    const order = await createOrder(env, { receipt, email, name, phone });

    /* Record the attempt so support can trace an incomplete purchase. */
    await recordOrder(env, {
      order_id: order.id,
      payment_id: null,
      email,
      name,
      phone,
      amount: EXPECTED_AMOUNT_PAISE,
      currency: EXPECTED_CURRENCY,
      status: 'created',
      source: 'create_order'
    }).catch((e) => logEvent('order_record_failed', { reason: e && e.message }));

    logEvent('order_created', { order_id: order.id });

    return ok(
      {
        order_id: order.id,
        amount: Number(order.amount),
        currency: order.currency,
        /* The key id is public by design — Razorpay's own checkout needs it
           in the browser. The key SECRET never leaves this Worker. */
        key_id: env.RAZORPAY_KEY_ID
      },
      headers
    );
  } catch (err) {
    logEvent('create_order_failed', { reason: err && err.message });
    return fail(
      'We could not start the payment right now. Please try again in a moment.',
      502,
      { error: 'order_creation_failed' },
      headers
    );
  }
}

/* POST /api/verify-payment --------------------------------------------- */
async function handleVerifyPayment(request, env, headers) {
  if (!originAllowed(request, env)) {
    return fail('This request origin is not allowed.', 403, { error: 'origin_not_allowed' }, headers);
  }

  const rl = await rateLimit(env, request, 'verify-payment', 40, 60 * 60 * 1000);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds, headers);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return fail('Invalid JSON body.', 400, { error: 'bad_json' }, headers);
  }

  const orderId = sanitizeText(body && body.razorpay_order_id, 64);
  const paymentId = sanitizeText(body && body.razorpay_payment_id, 64);
  const signature = sanitizeText(body && body.razorpay_signature, 256);

  if (!orderId || !paymentId || !signature) {
    return fail('Missing payment details.', 422, { error: 'missing_fields' }, headers);
  }

  /* STEP 1 — signature. Proves the details came from Razorpay. */
  let signatureValid = false;
  try {
    signatureValid = await verifyPaymentSignature(env, { orderId, paymentId, signature });
  } catch (err) {
    logEvent('signature_check_error', { reason: err && err.message });
    return fail('Verification is temporarily unavailable.', 503, { error: 'verification_unavailable' }, headers);
  }

  if (!signatureValid) {
    logEvent('invalid_signature', { order_id: orderId, payment_id_prefix: paymentId.slice(0, 8) });
    /* Do NOT reveal which part failed. */
    return fail('We could not verify this payment.', 400, { error: 'invalid_signature' }, headers);
  }

  /* STEP 2 — ask Razorpay for the truth (status, amount, currency). */
  let check;
  try {
    check = await assertCapturedPayment(env, { orderId, paymentId });
  } catch (err) {
    logEvent('payment_fetch_error', { order_id: orderId, reason: err && err.message });
    return fail('We could not confirm the payment with Razorpay yet.', 502, { error: 'provider_unreachable' }, headers);
  }

  if (!check.valid) {
    logEvent('payment_not_deliverable', { order_id: orderId, reason: check.reason });
    const messages = {
      amount_mismatch: 'The paid amount does not match this product.',
      currency_mismatch: 'The payment currency does not match this product.',
      order_mismatch: 'This payment does not belong to that order.',
      payment_not_found: 'We could not find that payment.'
    };
    return fail(
      messages[check.reason] || 'This payment is not complete yet. If money left your account it will be reconciled shortly.',
      409,
      { error: check.reason || 'payment_incomplete' },
      headers
    );
  }

  const payment = check.payment;
  const email = sanitizeEmail((payment.notes && payment.notes.email) || payment.email);

  /* STEP 3 — record the verified order (idempotent on payment_id). */
  const order = await recordOrder(env, {
    order_id: orderId,
    payment_id: paymentId,
    email,
    name: sanitizeText((payment.notes && payment.notes.name) || '', 80) || null,
    phone: sanitizeText((payment.notes && payment.notes.phone) || payment.contact || '', 20) || null,
    amount: Number(payment.amount),
    currency: String(payment.currency),
    status: 'paid',
    source: 'verify_payment'
  });

  /* STEP 4 — issue the browser session token. */
  const session = await issueToken(env, {
    orderId,
    paymentId,
    kind: 'session',
    ttlMs: tokenTtlMs(env)
  });

  /* STEP 5 — email delivery (safe to fail; the order stays recorded). */
  const existingEmail = order.email_status || 'pending';
  let emailResult = { emailed: false, emailStatus: existingEmail };
  try {
    emailResult = await deliverByEmail(env, { ...order, email_status: existingEmail });
  } catch (err) {
    logEvent('email_step_failed', { order_id: orderId, reason: err && err.message });
  }

  logEvent('payment_verified', {
    order_id: orderId,
    payment_id_prefix: paymentId.slice(0, 8),
    email_status: emailResult.emailStatus
  });

  return ok(
    {
      verified: true,
      order_id: orderId,
      payment_id: paymentId,
      amount: Number(payment.amount),
      currency: String(payment.currency),
      download_token: session.token,
      token_expires_at: session.expiresAt,
      email_sent: !!emailResult.emailed,
      email_status: emailResult.emailStatus
    },
    headers
  );
}

/* POST /api/webhook/razorpay ------------------------------------------- */
async function handleWebhook(request, env) {
  const rawBody = await request.text(); // raw text — required for HMAC
  const signature = request.headers.get('X-Razorpay-Signature');
  const eventId = request.headers.get('x-razorpay-event-id');

  let signatureValid = false;
  try {
    signatureValid = await verifyWebhookSignature(env, rawBody, signature);
  } catch (err) {
    logEvent('webhook_config_error', { reason: err && err.message });
    return fail('Webhook secret is not configured.', 500, { error: 'webhook_not_configured' });
  }

  if (!signatureValid) {
    logEvent('webhook_invalid_signature', { event_id: eventId || 'none' });
    return fail('Invalid webhook signature.', 401, { error: 'invalid_webhook_signature' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return fail('Invalid webhook payload.', 400, { error: 'bad_json' });
  }

  const eventType = payload && payload.event;

  /* Idempotency: x-razorpay-event-id is unique per event. A UNIQUE violation
     means we already handled this event — acknowledge and stop. */
  if (eventId) {
    try {
      await env.DB.prepare(
        'INSERT INTO webhook_events (event_id, event_type, payment_id, processed_at) VALUES (?, ?, ?, ?)'
      )
        .bind(eventId, eventType || 'unknown', (payload.payload && payload.payload.payment && payload.payload.payment.entity && payload.payload.payment.entity.id) || null, Date.now())
        .run();
    } catch (err) {
      logEvent('webhook_duplicate', { event_id: eventId, event_type: eventType });
      return ok({ duplicate: true }); // 200 so Razorpay stops retrying
    }
  }

  /* Only these events can lead to delivery. Everything else is recorded. */
  const DELIVERABLE = ['payment.captured', 'order.paid'];
  if (!DELIVERABLE.includes(eventType)) {
    logEvent('webhook_ignored', { event_type: eventType });
    return ok({ ignored: true, event_type: eventType });
  }

  const paymentEntity =
    (payload.payload && payload.payload.payment && payload.payload.payment.entity) || null;
  const orderEntity =
    (payload.payload && payload.payload.order && payload.payload.order.entity) || null;

  const paymentId = paymentEntity ? paymentEntity.id : null;
  const orderId = paymentEntity ? paymentEntity.order_id : (orderEntity ? orderEntity.id : null);

  if (!paymentId || !orderId) {
    logEvent('webhook_missing_ids', { event_type: eventType });
    return ok({ ignored: true, reason: 'missing_ids' });
  }

  /* Trust the webhook only for an event we verified — but still confirm the
     amount/currency from the payload, and re-check status via the API when the
     payload does not already say captured. */
  let amount = paymentEntity ? Number(paymentEntity.amount) : null;
  let currency = paymentEntity ? String(paymentEntity.currency) : null;
  let status = paymentEntity ? paymentEntity.status : null;

  if (eventType === 'order.paid') {
    try {
      const fresh = await fetchPayment(env, paymentId);
      amount = Number(fresh.amount);
      currency = String(fresh.currency);
      status = fresh.status;
      if (fresh.order_id && fresh.order_id !== orderId) {
        logEvent('webhook_order_mismatch', { event_type: eventType });
        return ok({ ignored: true, reason: 'order_mismatch' });
      }
    } catch (err) {
      /* Do not deliver on an unconfirmed state. Return an error so Razorpay
         retries this event later. */
      logEvent('webhook_confirm_failed', { order_id: orderId, reason: err && err.message });
      return fail('Could not confirm payment yet.', 500, { error: 'not_confirmed' });
    }
  }

  if (status !== 'captured') {
    logEvent('webhook_not_deliverable', { order_id: orderId, status: status || 'unknown' });
    return ok({ ignored: true, reason: 'not_captured' });
  }
  if (amount !== EXPECTED_AMOUNT_PAISE || currency !== EXPECTED_CURRENCY) {
    logEvent('webhook_amount_mismatch', { order_id: orderId });
    return ok({ ignored: true, reason: 'amount_mismatch' });
  }

  const email = sanitizeEmail(
    (paymentEntity && paymentEntity.email) ||
    (paymentEntity && paymentEntity.notes && paymentEntity.notes.email) ||
    null
  );

  const existing = await env.DB.prepare('SELECT * FROM orders WHERE payment_id = ?')
    .bind(paymentId)
    .first();

  const order = await recordOrder(env, {
    order_id: orderId,
    payment_id: paymentId,
    email: email || (existing && existing.email) || null,
    name: (existing && existing.name) || sanitizeText((paymentEntity && paymentEntity.notes && paymentEntity.notes.name) || '', 80) || null,
    phone: (existing && existing.phone) || sanitizeText(((paymentEntity && paymentEntity.contact) || ''), 20) || null,
    amount,
    currency,
    status: 'paid',
    source: existing && existing.source === 'verify_payment' ? 'verify_payment' : 'webhook'
  });

  /* The browser flow may already have delivered. Only email if it has not. */
  if (existing && existing.email_status === 'sent') {
    logEvent('webhook_email_already_sent', { order_id: orderId });
    return ok({ processed: true, email_sent: false });
  }

  let emailResult = { emailed: false, emailStatus: 'pending' };
  try {
    emailResult = await deliverByEmail(env, { ...order, email_status: existing ? existing.email_status : 'pending' });
  } catch (err) {
    logEvent('webhook_email_failed', { order_id: orderId, reason: err && err.message });
    /* The order IS recorded. Support can re-issue the link. Return 200 so
       Razorpay does not retry forever for a mail problem. */
    return ok({ processed: true, email_sent: false, email_status: 'failed' });
  }

  logEvent('webhook_processed', { order_id: orderId, email_status: emailResult.emailStatus });
  return ok({ processed: true, email_sent: !!emailResult.emailed, email_status: emailResult.emailStatus });
}

/* GET /api/download?t=... ---------------------------------------------- */
async function handleDownload(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('t') || url.searchParams.get('token');

  const rl = await rateLimit(env, request, 'download', 30, 60 * 60 * 1000);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds, {});

  if (!token || token.length < 32) {
    return fail('A valid download token is required.', 401, { error: 'missing_token' });
  }

  const row = await env.DB.prepare('SELECT * FROM tokens WHERE token = ?').bind(token).first();

  if (!row) {
    return fail(
      'This download link is not valid. Please request a new link.',
      404,
      { error: 'invalid_token' },
      {}
    );
  }
  if (row.used_at) {
    return fail(
      'This download link has already been used. Request a new link and we will email it to you.',
      410,
      { error: 'token_used' },
      {}
    );
  }
  if (Number(row.expires_at) < Date.now()) {
    return fail(
      'This download link has expired. Request a new link and we will email it to you.',
      410,
      { error: 'token_expired' },
      {}
    );
  }

  /* Atomic single-use claim: only the request that flips used_at from NULL
     to a value proceeds. A second concurrent request gets no rows changed. */
  const claim = await env.DB.prepare(
    'UPDATE tokens SET used_at = ? WHERE token = ? AND used_at IS NULL'
  )
    .bind(Date.now(), token)
    .run();

  const changed = (claim.meta && (claim.meta.changes ?? claim.meta.rows_written)) || 0;
  if (!changed) {
    return fail(
      'This download link has already been used. Request a new link and we will email it to you.',
      410,
      { error: 'token_used' },
      {}
    );
  }

  /* Serve the private file. */
  let object;
  try {
    object = await getPdf(env);
  } catch (err) {
    logEvent('r2_read_error', { reason: err && err.message });
    return fail('The file is temporarily unavailable. Please try again shortly.', 503, { error: 'storage_error' }, {});
  }

  if (!object) {
    logEvent('pdf_missing_in_r2', { key: env.PDF_OBJECT_KEY });
    /* Release the token so a fixed file can still be fetched with this link. */
    await env.DB.prepare('UPDATE tokens SET used_at = NULL WHERE token = ?').bind(token).run();
    return fail(
      'The course file is not available right now. Our team has been notified — please contact support.',
      503,
      { error: 'file_missing' },
      {}
    );
  }

  logEvent('download_served', { order_id: row.order_id, kind: row.kind });
  return pdfResponse(object, env);
}

/* POST /api/order-status ------------------------------------------------ */
async function handleOrderStatus(request, env, headers) {
  if (!originAllowed(request, env)) {
    return fail('This request origin is not allowed.', 403, { error: 'origin_not_allowed' }, headers);
  }
  const rl = await rateLimit(env, request, 'order-status', 60, 60 * 60 * 1000);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds, headers);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return fail('Invalid JSON body.', 400, { error: 'bad_json' }, headers);
  }

  const orderId = sanitizeText(body && body.order_id, 64);
  const email = sanitizeEmail(body && body.email);
  if (!orderId) return fail('An order id is required.', 422, { error: 'missing_order_id' }, headers);

  const order = await env.DB.prepare('SELECT * FROM orders WHERE order_id = ?')
    .bind(orderId)
    .orderBy('id', 'DESC')
    .first();

  if (!order) {
    return ok({ found: false, status: 'unknown' }, headers);
  }

  const paid = order.status === 'paid';
  /* A fresh session token is issued ONLY when the caller also proves the
     email address on the order — an order id alone is not a licence. */
  let downloadToken = null;
  if (paid && email && order.email && email === String(order.email).toLowerCase()) {
    const session = await issueToken(env, {
      orderId: order.order_id,
      paymentId: order.payment_id,
      kind: 'session',
      ttlMs: tokenTtlMs(env)
    });
    downloadToken = session.token;
  }

  return ok(
    {
      found: true,
      order_id: order.order_id,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      email_status: order.email_status,
      paid,
      download_token: downloadToken
    },
    headers
  );
}

/* POST /api/resend-link ------------------------------------------------- */
async function handleResendLink(request, env, headers) {
  if (!originAllowed(request, env)) {
    return fail('This request origin is not allowed.', 403, { error: 'origin_not_allowed' }, headers);
  }
  const rl = await rateLimit(env, request, 'resend-link', 5, 60 * 60 * 1000);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds, headers);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return fail('Invalid JSON body.', 400, { error: 'bad_json' }, headers);
  }

  const email = sanitizeEmail(body && body.email);

  /* Always answer the same way: this endpoint must not reveal whether an
     address has purchased anything. */
  const generic = {
    message: 'If a verified order exists for that address, a fresh download link is on its way. Please check your inbox and spam folder.'
  };

  if (!email) {
    return ok({ sent: false, ...generic }, headers);
  }

  const order = await env.DB.prepare(
    "SELECT * FROM orders WHERE email = ? AND status = 'paid' ORDER BY id DESC LIMIT 1"
  )
    .bind(email)
    .first();

  if (!order) {
    logEvent('resend_no_order', { email_domain: email.split('@')[1] || 'unknown' });
    return ok({ sent: false, ...generic }, headers);
  }

  try {
    /* `force` is intentional here: the customer asked for a new link, so a
       previously-sent email must not suppress this one. Each request creates a
       NEW single-use token in addition to any earlier ones. */
    const result = await deliverByEmail(env, { ...order, email_status: 'sent' }, { force: true });
    logEvent('resend_completed', { order_id: order.order_id, email_status: result.emailStatus });
    return ok({ sent: !!result.emailed, email_status: result.emailStatus, ...generic }, headers);
  } catch (err) {
    logEvent('resend_failed', { order_id: order.order_id, reason: err && err.message });
    return ok({ sent: false, email_status: 'failed', ...generic }, headers);
  }
}

/* GET /api/health ------------------------------------------------------- */
async function handleHealth(env) {
  const checks = {
    razorpay_key_id: !!env.RAZORPAY_KEY_ID,
    razorpay_key_secret: !!env.RAZORPAY_KEY_SECRET,
    razorpay_webhook_secret: !!env.RAZORPAY_WEBHOOK_SECRET,
    email_api_key: !!env.RESEND_API_KEY,
    email_from: !!env.EMAIL_FROM,
    pdf_object_key: !!env.PDF_OBJECT_KEY,
    public_site_url: !!env.PUBLIC_SITE_URL,
    expected_amount_paise: EXPECTED_AMOUNT_PAISE,
    expected_currency: EXPECTED_CURRENCY
  };

  try {
    const head = await headPdf(env);
    checks.pdf_present_in_r2 = !!head;
    checks.pdf_size_bytes = head ? head.size : 0;
    checks.pdf_uploaded_at = head ? head.uploaded && head.uploaded.toISOString() : null;
  } catch (err) {
    checks.pdf_present_in_r2 = false;
    checks.pdf_error = String(err && err.message).slice(0, 120);
  }

  try {
    await env.DB.prepare('SELECT 1').first();
    checks.database_reachable = true;
  } catch (err) {
    checks.database_reachable = false;
  }

  /* Only booleans and non-secret values are returned. */
  const ready = Object.entries(checks)
    .filter(([k]) => !['expected_amount_paise', 'expected_currency', 'pdf_size_bytes', 'pdf_uploaded_at'].includes(k))
    .every(([, v]) => v === true);

  return ok({ ready, checks }, 200, corsHeaders(new Request('https://local/'), env));
}

/* ======================================================================
   ROUTER
   ====================================================================== */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();
    const headers = corsHeaders(request, env);

    if (method === 'OPTIONS') return handlePreflight(request, env);

    try {
      if (path === '/api/health' && method === 'GET') return handleHealth(env);
      if (path === '/api/create-order' && method === 'POST') return handleCreateOrder(request, env, headers);
      if (path === '/api/verify-payment' && method === 'POST') return handleVerifyPayment(request, env, headers);
      if (path === '/api/webhook/razorpay' && method === 'POST') return handleWebhook(request, env);
      if (path === '/api/download' && method === 'GET') return handleDownload(request, env);
      if (path === '/api/order-status' && method === 'POST') return handleOrderStatus(request, env, headers);
      if (path === '/api/resend-link' && method === 'POST') return handleResendLink(request, env, headers);

      if (path === '/' || path === '/api') {
        return json({ ok: true, service: 'claude-ai-course-api', docs: '/api/health' }, 200, headers);
      }

      return fail('Not found.', 404, { error: 'not_found' }, headers);
    } catch (err) {
      logEvent('unhandled_error', { path, method, reason: err && err.message });
      return fail('Something went wrong on our side. Please try again.', 500, { error: 'internal_error' }, headers);
    }
  }
};
