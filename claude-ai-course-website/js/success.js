/* ==========================================================================
   js/success.js — powers the three payment status pages
     pages/success.html
     pages/payment-pending.html
     pages/payment-failed.html

   RULES ENFORCED HERE
   - The query string is NEVER trusted as proof of payment. `?verified=1` or
     `?success=true` only decides which message to *try* to show; the real
     answer always comes from the server.
   - The server only returns a download_token for an order it has verified as
     captured and paid.
   - All sensitive detail is read from the sessionStorage token written by the
     checkout on the SAME origin, or fetched fresh from the API.
   ========================================================================== */
(function () {
  'use strict';

  var cfg = window.COURSE_CONFIG || {};
  var params = new URLSearchParams(window.location.search);

  var orderIdFromUrl = params.get('order_id') || '';
  var paymentIdFromUrl = params.get('payment_id') || '';
  var page = (window.location.pathname.split('/').pop() || '').toLowerCase();

  function byId(id) { return document.getElementById(id); }

  function setText(id, value) {
    var el = byId(id);
    if (el) el.textContent = (value === undefined || value === null || value === '') ? '—' : String(value);
  }

  function readTokenFromSession() {
    try {
      return {
        token: window.sessionStorage.getItem('course_download_token') || '',
        orderId: window.sessionStorage.getItem('course_order_id') || '',
        email: window.sessionStorage.getItem('course_buyer_email') || ''
      };
    } catch (e) {
      return { token: '', orderId: '', email: '' };
    }
  }

  function clearSessionToken() {
    try {
      window.sessionStorage.removeItem('course_download_token');
    } catch (e) {}
  }

  function api(path, body) {
    var url = String(cfg.apiBaseUrl || '').replace(/\/+$/, '') + path;
    var controller = ('AbortController' in window) ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = window.setTimeout(function () { controller.abort(); },
        cfg.apiTimeoutMs || 20000);
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: controller ? controller.signal : undefined,
      credentials: 'omit'
    }).then(function (res) {
      if (timer) window.clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, data: data || {} };
      });
    });
  }

  function downloadUrlFor(token) {
    return String(cfg.apiBaseUrl || '').replace(/\/+$/, '') +
      '/api/download?t=' + encodeURIComponent(token);
  }

  function show(id) {
    var el = byId(id);
    if (el) el.hidden = false;
  }
  function hide(id) {
    var el = byId(id);
    if (el) el.hidden = true;
  }

  function formatMoney(paiseOrRupees) {
    var n = Number(paiseOrRupees);
    if (!isFinite(n)) return '';
    /* API returns paise; convert to rupees for display. */
    var rupees = n >= 1000 ? n / 100 : n;
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(rupees);
    } catch (e) { return '₹' + Math.round(rupees); }
  }

  /* ---- SUCCESS PAGE ---------------------------------------------------- */
  function runSuccessPage() {
    var session = readTokenFromSession();
    var orderId = orderIdFromUrl || session.orderId;

    setText('orderIdText', orderId || 'provided in your email');

    /* If the server already handed us a session token at checkout, use it
       immediately — no need to re-query. */
    if (session.token && (!orderIdFromUrl || session.orderId === orderIdFromUrl)) {
      renderReady(session.token, orderId, null);
      /* Still confirm the server's view of the order for the detail list. */
      confirmWithServer(orderId, session.email, session.token, true);
      return;
    }

    if (!orderId) {
      showNotConfirmed('We could not find an order reference in this link. If you completed a payment, check your email for the download link or contact support with your payment ID.');
      return;
    }

    confirmWithServer(orderId, session.email, '', false);
  }

  function confirmWithServer(orderId, email, knownToken, silent) {
    api('/api/order-status', { order_id: orderId, email: email })
      .then(function (res) {
        var data = res.data || {};
        if (data.ok && data.found && data.paid && data.download_token) {
          renderReady(data.download_token, orderId, data);
          return;
        }
        if (data.ok && data.found && data.paid && knownToken) {
          renderReady(knownToken, orderId, data);
          return;
        }
        if (data.ok && data.found && data.paid && !data.download_token) {
          /* Paid, but this browser did not prove the email address, so no new
             token is issued. The emailed link still works. */
          renderReady(knownToken || '', orderId, data, true);
          return;
        }
        if (!silent) {
          showNotConfirmed('This payment is not confirmed as complete yet. If you have already paid, it may still be settling — use “Check again” or contact support.');
        }
      })
      .catch(function () {
        if (!silent) {
          showNotConfirmed('We could not reach our verification server. Your payment is safe — please retry in a moment, or contact support.');
        }
      });
  }

  function renderReady(token, orderId, data, withoutToken) {
    hide('stateVerifying');
    hide('statePending');
    show('stateReady');

    setText('orderIdText', orderId || (data && data.order_id) || '—');
    setText('payStatusText', 'verified as paid');
    if (data && data.amount) setText('amountText', formatMoney(data.amount));

    var emailStatus = (data && data.email_status) || '';
    var emailText = '—';
    if (emailStatus === 'sent') emailText = 'Sent to your email address';
    else if (emailStatus === 'no_email') emailText = 'No email on this order — use the download button';
    else if (emailStatus) emailText = 'Recorded; our team can re-send on request';
    setText('emailStatusText', emailText);

    var btn = byId('downloadBtn');
    if (token) {
      var href = downloadUrlFor(token);
      btn.href = href;
      setText('downloadUrlText', href);
      show('downloadFallback');
      /* Best-effort automatic download. Browsers may block it, which is
         exactly why the button and the copyable link stay visible. */
      window.setTimeout(function () {
        try {
          var a = document.createElement('a');
          a.href = href;
          a.rel = 'nofollow';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          window.setTimeout(function () { a.remove(); }, 1500);
        } catch (e) { /* the button remains as the fallback */ }
        clearSessionToken(); /* do not keep the secret in the tab */
      }, 900);
    } else {
      /* No fresh token: point the customer at the emailed link. */
      btn.href = '../index.html#contact';
      btn.textContent = 'Get my link by email';
      setText('downloadUrlText', 'Use the download button in the email we sent you.');
      show('downloadFallback');
      if (withoutToken) {
        var note = byId('verifyingNote');
        if (note) note.textContent = '';
      }
    }

    var resend = byId('resendBtn');
    var status = byId('resendStatus');
    resend.addEventListener('click', function () {
      var email = (readTokenFromSession().email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        status.className = 'form-status is-error';
        status.textContent = 'We do not have your email in this browser. Please email ' + (cfg.supportEmail || 'support') + ' with your order reference.';
        return;
      }
      resend.disabled = true;
      status.className = 'form-status';
      status.textContent = 'Sending a new link…';
      api('/api/resend-link', { email: email }).then(function () {
        status.className = 'form-status is-ok';
        status.textContent = 'If a verified order exists for ' + email + ', a new link is on its way. Check your spam folder too.';
      }).catch(function () {
        status.className = 'form-status is-error';
        status.textContent = 'Could not reach the server. Please try again shortly.';
      }).then(function () {
        resend.disabled = false;
      });
    });

    clearSessionToken();
  }

  function showNotConfirmed(message) {
    hide('stateVerifying');
    hide('stateReady');
    show('statePending');

    setText('pendingOrderId', orderIdFromUrl || readTokenFromSession().orderId || 'unknown');
    setText('pendingStatus', 'not confirmed');
    var reasonEl = byId('pendingReason');
    if (reasonEl && message) reasonEl.textContent = message;

    var link = byId('pendingLink');
    if (link && orderIdFromUrl) {
      link.href = 'payment-pending.html?order_id=' + encodeURIComponent(orderIdFromUrl);
    }

    var recheck = byId('recheckBtn');
    if (recheck) {
      recheck.addEventListener('click', function () {
        recheck.disabled = true;
        recheck.textContent = 'Checking…';
        var s = readTokenFromSession();
        api('/api/order-status', { order_id: orderIdFromUrl || s.orderId, email: s.email })
          .then(function (res) {
            var data = res.data || {};
            if (data.ok && data.found && data.paid && data.download_token) {
              renderReady(data.download_token, data.order_id, data);
            } else {
              recheck.disabled = false;
              recheck.textContent = 'Check again';
              if (reasonEl) reasonEl.textContent = 'Still not confirmed. If money has left your account, contact support with your order reference — we will resolve it manually.';
            }
          })
          .catch(function () {
            recheck.disabled = false;
            recheck.textContent = 'Check again';
          });
      });
    }
  }

  /* ---- PENDING PAGE ---------------------------------------------------- */
  function runPendingPage() {
    setText('orderIdText', orderIdFromUrl || readTokenFromSession().orderId || 'unknown');
    setText('reasonText', params.get('reason') === 'window_closed'
      ? 'The payment window was closed before the result came back.'
      : 'Waiting for the bank and Razorpay to confirm this transaction.');

    var recheck = byId('recheckBtn');
    var status = byId('actionStatus');
    if (recheck) {
      recheck.addEventListener('click', function () {
        recheck.disabled = true;
        status.className = 'form-status';
        status.textContent = 'Checking with the server…';
        var s = readTokenFromSession();
        api('/api/order-status', { order_id: orderIdFromUrl || s.orderId, email: s.email })
          .then(function (res) {
            var data = res.data || {};
            if (data.ok && data.found && data.paid) {
              if (data.download_token) {
                try {
                  window.sessionStorage.setItem('course_download_token', data.download_token);
                  window.sessionStorage.setItem('course_order_id', data.order_id || orderIdFromUrl);
                } catch (e) {}
              }
              status.className = 'form-status is-ok';
              status.textContent = 'Payment confirmed. Opening your download page…';
              window.location.href = 'success.html?order_id=' + encodeURIComponent(data.order_id || orderIdFromUrl) + '&verified=1';
              return;
            }
            status.className = 'form-status is-error';
            status.textContent = 'Still not confirmed. A pending payment can take a few minutes — or contact support if you were charged.';
            setText('statusText', (data && data.status) || 'pending');
            recheck.disabled = false;
          })
          .catch(function () {
            status.className = 'form-status is-error';
            status.textContent = 'Could not reach the server. Please try again shortly.';
            recheck.disabled = false;
          });
      });
    }

    var resend = byId('resendBtn');
    if (resend) {
      resend.addEventListener('click', function () {
        var email = (readTokenFromSession().email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          status.className = 'form-status is-error';
          status.textContent = 'We do not have your email in this browser. Please email ' + (cfg.supportEmail || 'support') + '.';
          return;
        }
        resend.disabled = true;
        status.className = 'form-status';
        status.textContent = 'Requesting a link…';
        api('/api/resend-link', { email: email }).then(function () {
          status.className = 'form-status is-ok';
          status.textContent = 'If a verified order exists for ' + email + ', a new link is on its way. Nothing is sent for unverified orders.';
        }).catch(function () {
          status.className = 'form-status is-error';
          status.textContent = 'Could not reach the server. Please try again shortly.';
        }).then(function () { resend.disabled = false; });
      });
    }
  }

  /* ---- FAILED PAGE ----------------------------------------------------- */
  function runFailedPage() {
    setText('orderIdText', orderIdFromUrl || readTokenFromSession().orderId || '—');
    setText('paymentIdText', paymentIdFromUrl || 'not created');

    var reason = params.get('reason') || '';
    var map = {
      verification_failed: 'The payment could not be verified. No course file was released.',
      razorpay_failed: 'Razorpay reported that the payment attempt did not succeed.',
      cancelled: 'The payment was cancelled before it completed.'
    };
    setText('reasonText', map[reason] || 'The payment was not completed.');

    if (reason === 'verification_failed') {
      var msg = byId('failMessage');
      if (msg) {
        msg.textContent = 'Razorpay did not confirm this payment as captured, so we did not release the file. If money was deducted, contact support with the payment ID below — we will check it and deliver your PDF or arrange a refund. Do not pay twice.';
      }
    }
  }

  /* ---- Boot ------------------------------------------------------------ */
  function boot() {
    if (page === 'success.html') runSuccessPage();
    else if (page === 'payment-pending.html') runPendingPage();
    else if (page === 'payment-failed.html') runFailedPage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
