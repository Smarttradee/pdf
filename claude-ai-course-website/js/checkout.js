/* ==========================================================================
   js/checkout.js — Razorpay Standard Checkout integration (front end)

   FLOW
   1. Customer clicks any [data-buy] button → email modal opens.
   2. We POST /api/create-order with the email. The SERVER decides the amount
      (₹1,449 = 144900 paise) and returns a Razorpay order_id + the public key id.
   3. We load Razorpay's checkout.js and open it with that order_id.
   4. On success we POST /api/verify-payment { order_id, payment_id, signature }.
      The SERVER verifies the HMAC signature and the payment with Razorpay.
      Only then does it return a single-use download token.
   5. Success page shows the download button; the same link is emailed.

   SECURITY NOTES
   - A redirect or a ?success=true query is NEVER treated as proof of payment.
   - No amount is ever sent from here as authoritative — the server owns it.
   - No secret key exists in this file or anywhere in the front end.
   ========================================================================== */
(function () {
  'use strict';

  var cfg = window.COURSE_CONFIG || {};
  var UI = window.CourseUI || null;

  /* --- Small helpers ---------------------------------------------------- */
  function request(path, body, timeoutMs) {
    var url = String(cfg.apiBaseUrl || '').replace(/\/+$/, '') + path;
    var controller = ('AbortController' in window) ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = window.setTimeout(function () { controller.abort(); }, timeoutMs || cfg.apiTimeoutMs || 20000);
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: controller ? controller.signal : undefined,
      credentials: 'omit',
      mode: 'cors'
    }).then(function (res) {
      if (timer) window.clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || !data || data.ok === false) {
          var msg = (data && (data.message || data.error)) || ('Request failed (' + res.status + ')');
          throw new Error(msg);
        }
        return data;
      });
    });
  }

  function setStatus(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('is-error', 'is-ok');
    if (kind) el.classList.add(kind);
  }

  function isEmail(value) {
    /* Deliberately simple and strict enough: one @, a dot in the domain,
       no spaces. Real validation also happens server-side. */
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
  }

  function loadCheckoutScript() {
    return new Promise(function (resolve, reject) {
      if (window.Razorpay) { resolve(window.Razorpay); return; }
      var existing = document.querySelector('script[data-razorpay-checkout]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(window.Razorpay); });
        existing.addEventListener('error', function () { reject(new Error('checkout-script-failed')); });
        return;
      }
      var s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.setAttribute('data-razorpay-checkout', '1');
      s.onload = function () { resolve(window.Razorpay); };
      s.onerror = function () { reject(new Error('checkout-script-failed')); };
      document.head.appendChild(s);
    });
  }

  function goTo(page, params) {
    var qs = params ? ('?' + new URLSearchParams(params).toString()) : '';
    window.location.href = 'pages/' + page + qs;
  }

  /* --- Modal ------------------------------------------------------------ */
  function initModal() {
    var modal = document.getElementById('checkoutModal');
    if (!modal || !UI) return null;

    UI.$$('[data-buy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        UI.openModal(modal);
        var status = document.getElementById('checkoutStatus');
        setStatus(status, '');
      });
    });

    UI.$$('[data-close-modal]', modal).forEach(function (btn) {
      btn.addEventListener('click', function () { UI.closeModal(modal); });
    });

    /* Click on the backdrop closes it */
    modal.addEventListener('click', function (e) {
      if (e.target === modal) UI.closeModal(modal);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) {
        UI.closeModal(modal);
        return;
      }
      UI.trapFocus(modal, e);
    });

    return modal;
  }

  /* --- Payment Link fallback ------------------------------------------- */
  /* Used only when the secure backend is unreachable. A Razorpay Payment Link
     gives NO signed callback, so we cannot verify it from the browser. We send
     the customer to the link and explain that the download arrives by email
     after the payment is verified on our side, or via support with their
     payment ID. This is honest: we never pretend the link proves payment. */
  function offerPaymentLinkFallback(statusEl, email) {
    if (!cfg.enablePaymentLinkFallback || !cfg.paymentLinkUrl) {
      setStatus(statusEl, 'Checkout is temporarily unavailable. Please email ' +
        (cfg.supportEmail || 'support') + ' and we will send you a payment link.', 'is-error');
      return;
    }
    setStatus(statusEl,
      'Our secure checkout is not reachable right now. Opening our Razorpay payment page instead — ' +
      'after paying, send your payment ID to ' + (cfg.supportEmail || 'support') +
      ' and we will email your download link.', '');
    try { window.sessionStorage.setItem('course_buyer_email', email || ''); } catch (e) {}
    window.setTimeout(function () {
      window.location.href = cfg.paymentLinkUrl;
    }, 1600);
  }

  /* --- Submit ----------------------------------------------------------- */
  function initForm(modal) {
    var form = document.getElementById('checkoutForm');
    if (!form) return;

    var emailEl = document.getElementById('buyerEmail');
    var nameEl = document.getElementById('buyerName');
    var phoneEl = document.getElementById('buyerPhone');
    var emailErr = document.getElementById('emailError');
    var statusEl = document.getElementById('checkoutStatus');
    var payBtn = document.getElementById('payBtn');

    emailEl.addEventListener('input', function () {
      emailErr.hidden = true;
      emailErr.textContent = '';
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var email = String(emailEl.value || '').trim().toLowerCase();
      var name = nameEl ? String(nameEl.value || '').trim() : '';
      var phone = phoneEl ? String(phoneEl.value || '').trim() : '';

      if (!isEmail(email)) {
        emailErr.textContent = 'Please enter a valid email address — your download link is sent there.';
        emailErr.hidden = false;
        emailEl.focus();
        return;
      }

      payBtn.disabled = true;
      payBtn.setAttribute('aria-disabled', 'true');
      setStatus(statusEl, 'Creating your secure order…');

      request('/api/create-order', { email: email, name: name, phone: phone })
        .then(function (order) {
          if (!order.order_id || !order.key_id) throw new Error('Order could not be created.');
          try {
            window.sessionStorage.setItem('course_buyer_email', email);
            window.sessionStorage.setItem('course_order_id', order.order_id);
          } catch (e2) {}

          return loadCheckoutScript().then(function (Razorpay) {
            if (!Razorpay) throw new Error('Could not load the payment window.');

            setStatus(statusEl, 'Opening the secure payment window…');

            var options = {
              key: order.key_id,                 /* public key id only */
              amount: order.amount,              /* echoed for display */
              currency: order.currency || 'INR',
              name: cfg.brandName || 'Course',
              description: cfg.productName || 'Digital PDF course',
              order_id: order.order_id,          /* server-created order */
              prefill: { email: email, name: name, contact: phone },
              notes: { product: 'claude-ai-video-editing-course' },
              theme: { color: '#CC785C' },
              modal: {
                confirm_close: true,
                ondismiss: function () {
                  /* NOT a failure and NOT a success — the customer may still
                     complete the payment. The pending page asks the server. */
                  payBtn.disabled = false;
                  payBtn.removeAttribute('aria-disabled');
                  goTo('payment-pending.html', { order_id: order.order_id, reason: 'window_closed' });
                }
              },
              handler: function (response) {
                /* response = { razorpay_payment_id, razorpay_order_id, razorpay_signature } */
                setStatus(statusEl, 'Verifying your payment…');

                request('/api/verify-payment', {
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature
                }).then(function (verified) {
                  if (!verified.verified) throw new Error('Payment could not be verified.');
                  try {
                    /* Single-use token, held only for this browser tab. */
                    window.sessionStorage.setItem('course_download_token', verified.download_token || '');
                    window.sessionStorage.setItem('course_order_id', verified.order_id || order.order_id);
                  } catch (e3) {}
                  setStatus(statusEl, 'Payment verified. Opening your download…', 'is-ok');
                  goTo('success.html', { order_id: verified.order_id || order.order_id, verified: '1' });
                }).catch(function (err) {
                  goTo('payment-failed.html', {
                    order_id: order.order_id,
                    payment_id: response.razorpay_payment_id || '',
                    reason: 'verification_failed'
                  });
                  window.console && console.warn('Verification error:', err && err.message);
                });
              }
            };

            var rzp = new Razorpay(options);

            rzp.on('payment.failed', function (resp) {
              var pid = (resp && resp.error && resp.error.metadata && resp.error.metadata.payment_id) || '';
              goTo('payment-failed.html', {
                order_id: order.order_id,
                payment_id: pid,
                reason: 'razorpay_failed'
              });
            });

            rzp.open();
          });
        })
        .catch(function (err) {
          payBtn.disabled = false;
          payBtn.removeAttribute('aria-disabled');
          var message = String((err && err.message) || 'Something went wrong.');
          /* Network / unreachable backend → offer the honest fallback */
          if (/abort|Failed to fetch|NetworkError|load the payment/i.test(message)) {
            offerPaymentLinkFallback(statusEl, email);
          } else {
            setStatus(statusEl, message + ' If this keeps happening, email ' +
              (cfg.supportEmail || 'support') + '.', 'is-error');
          }
        });
    });
  }

  function boot() {
    var modal = initModal();
    if (modal) initForm(modal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
