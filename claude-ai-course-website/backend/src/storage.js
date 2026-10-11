/* ==========================================================================
   backend/src/storage.js
   Private PDF storage on Cloudflare R2.

   The bucket must be PRIVATE: no R2.dev public URL, no custom public domain
   and no public bucket policy. The only way to read the file is through this
   Worker, and this Worker only serves it to a valid, unused, unexpired token.
   ========================================================================== */

function bucket(env) {
  if (!env.PDF_BUCKET) throw new Error('PDF_BUCKET R2 binding is not configured');
  return env.PDF_BUCKET;
}

function objectKey(env) {
  if (!env.PDF_OBJECT_KEY) throw new Error('PDF_OBJECT_KEY is not configured');
  return env.PDF_OBJECT_KEY;
}

export function pdfFilename(env) {
  return env.PDF_FILENAME || 'Claude-AI-Video-Editing-Course.pdf';
}

/** Fetch the private PDF object from R2. Returns null when it is missing. */
export async function getPdf(env, key) {
  return bucket(env).get(key || objectKey(env));
}

/** Metadata only — used by /api/health to confirm the file is in place. */
export async function headPdf(env, key) {
  return bucket(env).head(key || objectKey(env));
}

/**
 * Build the download Response.
 * The file is streamed straight from R2 — it is never copied to a public
 * location and never given a cacheable, shareable URL.
 */
export function pdfResponse(object, env) {
  const headers = new Headers();
  headers.set('Content-Type', 'application/pdf');
  /* `attachment` forces a download and keeps the document out of the
     browser's inline viewer history. */
  headers.set(
    'Content-Disposition',
    `attachment; filename="${pdfFilename(env)}"`
  );
  headers.set('Content-Length', String(object.size));
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  headers.set('Pragma', 'no-cache');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  /* No CORS allowance: this response is for the buyer's browser to save,
     not for any third-party page to read. */
  return new Response(object.body, { status: 200, headers });
}
