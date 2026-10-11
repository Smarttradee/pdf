/* ==========================================================================
   js/config.js — PUBLIC front-end configuration ONLY.
   --------------------------------------------------------------------------
   EVERYTHING IN THIS FILE IS DOWNLOADED BY EVERY VISITOR.
   So: no secrets here, ever. No Razorpay key SECRET, no webhook secret,
   no email API key, no storage credentials. Those live in the Cloudflare
   Worker's secret manager (see backend/.dev.vars.example + backend/README.md).

   Safe to keep here: the Razorpay KEY ID (it is public by design and is sent
   to the browser by Razorpay's own checkout), prices, URLs, support email.
   ========================================================================== */

window.COURSE_CONFIG = {
  /* ---- Product ---------------------------------------------------------- */
  brandName: 'Claude AI Video Editing Course',
  productName: 'Claude AI Video Editing Course (Digital PDF)',

  /* ---- Pricing (display only — the SERVER fixes the real amount) -------- */
  currency: 'INR',
  priceInr: 1449,
  originalPriceInr: 4999,

  /* ---- Backend (Cloudflare Worker) -------------------------------------- */
  /* Replace with your deployed Worker URL, e.g.
     'https://claude-course-api.your-subdomain.workers.dev'
     This is a PUBLIC url. It is not a secret.                         */
  apiBaseUrl: 'https://claude-course-api.example.workers.dev',
  /* Optional: your own custom API domain if you attach one to the Worker */
  apiTimeoutMs: 20000,

  /* ---- Fallback: your existing Razorpay Payment Link -------------------- */
  /* Used ONLY if the secure backend checkout is unreachable. A Payment Link
     cannot produce a signed callback, so orders paid this way are verified by
     you in the Razorpay dashboard and released through the support flow.
     See README.md → "Payment Link fallback".                            */
  paymentLinkUrl: 'https://rzp.io/rzp/30cJdSU',
  enablePaymentLinkFallback: true,

  /* ---- Course facts ----------------------------------------------------- */
  /* Leave EMPTY until the real page count is confirmed.
     Set it to a number (e.g. 84) to display "84 pages" on the page.
     Never guess this value.                                             */
  pdfPageCount: '',

  /* ---- Support ---------------------------------------------------------- */
  supportEmail: 'support@example.com',
  supportHours: 'Monday to Saturday, 10:00 AM – 6:00 PM IST',

  /* ---- Delivery --------------------------------------------------------- */
  /* Shown to the customer. The server decides the real expiry. */
  downloadLinkTtlHours: 24,

  /* ---- Site ------------------------------------------------------------- */
  siteUrl: 'https://example.com'
};
