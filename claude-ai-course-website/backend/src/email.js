/* ==========================================================================
   backend/src/email.js
   Transactional email through Resend (https://resend.com).

   Setup notes (see backend/README.md):
   - Verify your sending domain in Resend and add its DNS records.
   - Set EMAIL_FROM to an address on that verified domain
     (e.g. "Claude AI Course <no-reply@yourdomain.com>").
   - Set RESEND_API_KEY as a Worker secret.

   The email contains ONLY a short-lived, single-use download link that points
   at our own success page. It never contains a public PDF URL.
   ========================================================================== */

import { logEvent } from './security.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function emailHtml({ brandName, name, downloadUrl, supportEmail, expiresHours, orderId }) {
  const who = name ? escapeHtml(name.split(' ')[0]) : 'there';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your download is ready</title></head>
<body style="margin:0;padding:24px 12px;background:#F5F0E8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1F1B16;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFDF9;border:1px solid #E2D9C8;border-radius:16px;overflow:hidden;">
    <tr><td style="height:5px;background:#CC785C;"></td></tr>
    <tr><td style="padding:28px 26px 8px;">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#B5654A;font-weight:700;">Payment confirmed</p>
      <h1 style="margin:0 0 12px;font-size:26px;line-height:1.2;font-weight:400;font-family:Georgia,'Times New Roman',serif;">Hi ${who}, your course PDF is ready</h1>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#4A4238;">
        Thanks for purchasing <strong>${escapeHtml(brandName)}</strong>. Your payment has been verified.
        Click the button below to download the PDF.
      </p>
      <p style="margin:0 0 22px;">
        <a href="${downloadUrl}" style="display:inline-block;background:#CC785C;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:999px;">Download your course PDF</a>
      </p>
      <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#857B6D;">
        This link is personal, single-use and expires in about ${expiresHours} hour(s).
        If you need a new one later, use the “send me a new link” option on the download
        page or email <a href="mailto:${escapeHtml(supportEmail)}" style="color:#B5654A;">${escapeHtml(supportEmail)}</a>.
      </p>
      <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#857B6D;">
        Order reference: ${escapeHtml(orderId || '')}
      </p>
      <p style="margin:0 0 22px;font-size:12px;line-height:1.6;color:#857B6D;">
        If the button does not work, copy and paste this address into your browser:<br>
        <span style="word-break:break-all;color:#4A4238;">${downloadUrl}</span>
      </p>
    </td></tr>
    <tr><td style="padding:16px 26px 26px;border-top:1px solid #E2D9C8;">
      <p style="margin:0;font-size:11px;line-height:1.6;color:#857B6D;">
        You received this email because a purchase was completed with this address.
        This is a digital product — nothing is shipped.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function emailText({ brandName, name, downloadUrl, supportEmail, expiresHours, orderId }) {
  return [
    `Hi ${name || 'there'},`,
    '',
    `Thanks for purchasing ${brandName}. Your payment has been verified.`,
    '',
    'Download your course PDF here:',
    downloadUrl,
    '',
    `This link is personal, single-use and expires in about ${expiresHours} hour(s).`,
    `Need a new link? Email ${supportEmail} with your order reference.`,
    '',
    `Order reference: ${orderId || ''}`,
    '',
    'You received this email because a purchase was completed with this address.',
    'This is a digital product - nothing is shipped.'
  ].join('\n');
}

/**
 * Send the download email.
 * Never throws for a business-level failure: the caller records the result so
 * the verified order is preserved and support can re-send later.
 */
export async function sendDownloadEmail(env, { to, name, downloadUrl, orderId, paymentId }) {
  const expiresHours = Number(env.DOWNLOAD_LINK_TTL_HOURS || 24);
  const supportEmail = env.SUPPORT_EMAIL || 'support@example.com';
  const brandName = env.BRAND_NAME || 'Claude AI Video Editing Course';

  if (!env.RESEND_API_KEY) {
    logEvent('email_not_configured', { order_id: orderId });
    return { sent: false, reason: 'email_not_configured' };
  }
  if (!env.EMAIL_FROM) {
    logEvent('email_from_missing', { order_id: orderId });
    return { sent: false, reason: 'email_from_missing' };
  }

  const payload = {
    from: env.EMAIL_FROM,
    to: [to],
    subject: 'Your course PDF is ready to download',
    html: emailHtml({ brandName, name, downloadUrl, supportEmail, expiresHours, orderId }),
    text: emailText({ brandName, name, downloadUrl, supportEmail, expiresHours, orderId }),
    /* Replies go to a monitored inbox, not the no-reply sender. */
    reply_to: supportEmail,
    headers: { 'X-Entity-Ref-ID': String(orderId || paymentId || 'order') }
  };

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      logEvent('email_send_failed', {
        order_id: orderId,
        status: res.status,
        reason: (data && data.message) || 'unknown'
      });
      return { sent: false, reason: `provider_error_${res.status}` };
    }

    logEvent('email_sent', { order_id: orderId, provider_id: data && data.id });
    return { sent: true, providerId: data && data.id };
  } catch (err) {
    logEvent('email_send_exception', { order_id: orderId, reason: err && err.message });
    return { sent: false, reason: 'network_error' };
  }
}
