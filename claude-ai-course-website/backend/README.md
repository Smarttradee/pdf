# Backend — Cloudflare Worker API

Ye folder **Claude AI Video Editing Course** ka secure backend hai. Isse GitHub Pages par deploy **nahi** karna — ye Cloudflare Workers par jata hai.

> Frontend/project ke baaki hisse ke liye upar wali `../README.md` dekho. Ye file sirf backend ki hai.

---

## Ye kya karta hai

| Route | Method | Kaam |
|-------|--------|------|
| `/api/create-order` | POST | Razorpay order banata hai. Amount **server par fixed**: ₹1,449 = `144900` paise. |
| `/api/verify-payment` | POST | Signature verify karta hai, Razorpay se payment confirm karata hai, phir download token deta hai. |
| `/api/webhook/razorpay` | POST | Razorpay webhook. HMAC verify (raw body) + duplicate events ko idempotent handle. |
| `/api/download?t=...` | GET | Single-use, expiring token check karke private PDF bhejta hai. |
| `/api/order-status` | POST | Order ka status (pending page isko use karta hai). |
| `/api/resend-link` | POST | Naya download link email karta hai (rate limited, silent response). |
| `/api/health` | GET | Config ready hai ya nahi — sirf booleans, koi secret nahi. |

---

## Security model (ye samajhna zaroori hai)

1. **Redirect = proof nahi.** `success` page par aana ya `?success=true` hona payment ka proof nahi hai.
2. **Signature verification.** Razorpay `order_id|payment_id` par HMAC-SHA256 sign karta hai, hamari `RAZORPAY_KEY_SECRET` se. Hum wahi dobara calculate karke constant-time compare karte hain.
3. **Status + amount check.** Signature ke baad hum Razorpay se `payments/:id` maangte hain aur check karte hain: `status === 'captured'`, `amount === 144900`, `currency === 'INR'`, aur `order_id` match karta hai.
4. **Amount frontend se nahi aata.** Price sirf `security.js` ke `EXPECTED_AMOUNT_PAISE` se aati hai.
5. **Webhook.** `X-Razorpay-Signature` ko **raw request body** par `RAZORPAY_WEBHOOK_SECRET` se verify karte hain. Body ko parse karke dobara stringify karne se signature **toot** jayegi — isliye code `request.text()` use karta hai.
6. **Idempotency.** Razorpay ka `x-razorpay-event-id` unique hota hai. Hum use `webhook_events` table mein insert karte hain; duplicate par UNIQUE error aata hai → hum 200 return karke chhod dete hain. `orders.payment_id` bhi UNIQUE hai, to ek payment se do order ban hi nahi sakte.
7. **Single-use tokens.** Har token 256-bit random hai, D1 mein store hota hai, aur `UPDATE ... WHERE used_at IS NULL` se **atomically** claim hota hai. Doosri baar use karne par 410.
8. **Private PDF.** R2 bucket private hai. File sirf token ke through, Worker se stream hoti hai. Koi public URL nahi.
9. **Rate limiting.** D1-backed fixed-window counters: create-order 15/hour, verify 40/hour, download 30/hour, resend 5/hour (per IP). Limiter fail ho to **fail-open** hota hai — asli customer block nahi hota, par payment verification protection chalu rehti hai.
10. **Logging.** Sirf IDs log karte hain (order_id, payment_id ka pehla 8 chars). Signature, secret, ya pura email **kabhi** nahi.

---

## Setup (step by step)

### 1. Tools

```bash
node --version        # Node 18+ chahiye
npm install           # backend folder ke andar
```

### 2. D1 database

```bash
npx wrangler login
npm run db:create     # output mein database_id milega
```

Output mein aaya `database_id` `wrangler.toml` ke `<your-d1-database-id>` ki jagah paste karo, phir:

```bash
npm run db:migrate        # remote (production) tables
npm run db:migrate:local  # local dev tables
```

### 3. R2 bucket (private)

```bash
npx wrangler r2 bucket create claude-course-private
```

**Zaroori:** R2 bucket par public access **on nahi** karna.
- ❌ `r2.dev` public URL enable na karo
- ❌ public custom domain attach na karo
- ❌ public bucket policy na lagao

`wrangler.toml` mein binding already set hai:

```toml
[[r2_buckets]]
binding = "PDF_BUCKET"
bucket_name = "claude-course-private"
```

### 4. PDF upload karna (private)

```bash
# object key wahi rakho jo wrangler.toml mein PDF_OBJECT_KEY hai
npx wrangler r2 object put claude-course-private/private/claude-ai-video-editing-course.pdf \
  --file="/full/path/to/your-course.pdf"
```

Check karo:

```bash
npx wrangler r2 object get claude-course-private/private/claude-ai-video-editing-course.pdf --file=/tmp/check.pdf
ls -lh /tmp/check.pdf && rm /tmp/check.pdf
```

Ya sirf `/api/health` kholo — `pdf_present_in_r2: true` aur `pdf_size_bytes` dikhega.

### 5. Secrets

```bash
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY
```

Ya Cloudflare dashboard: **Workers & Pages → your worker → Settings → Variables and Secrets** → type **Secret** → **Encrypt**.

Current secrets dekhne ke liye (values nahi dikhte, sirf naam): `npx wrangler secret list`

### 6. `wrangler.toml` mein placeholders badlo

```toml
PUBLIC_SITE_URL = "https://yourdomain.com"
ALLOWED_ORIGINS = "https://yourdomain.com,https://www.yourdomain.com"
SUPPORT_EMAIL   = "your-real-support@yourdomain.com"
EMAIL_FROM      = "Claude AI Course <no-reply@yourdomain.com>"
PDF_OBJECT_KEY  = "private/claude-ai-video-editing-course.pdf"
PDF_FILENAME    = "Claude-AI-Video-Editing-Course.pdf"
```

### 7. Deploy

```bash
npm run deploy
```

Deploy ke baad URL note karo. Test:

```bash
curl https://claude-course-api.your-subdomain.workers.dev/api/health
```

Phir `../js/config.js` mein `apiBaseUrl` update karo aur frontend push kar do.

---

## Resend (email) setup

1. resend.com par account banao → **API Keys** → key banao → `RESEND_API_KEY` secret mein daalo.
2. **Domains** → apna domain add karo → jo DNS records (SPF/DKIM/DMARC) dikhein, wo domain provider ke panel mein daalo.
3. Verify hone par `EMAIL_FROM` ko us domain ka address banao, jaise `Claude AI Course <no-reply@yourdomain.com>`.

**Testing tip:** domain verify hone se pehle Resend sirf `onboarding@resend.dev` se apne hi account email par bhejne deta hai. Isliye pehle local test `EMAIL_FROM = Claude AI Course <onboarding@resend.dev>` ke saath karo.

**Agar email fail ho jaye:** order fir bhi `orders` table mein record rehta hai (`email_status = 'failed'`). Iska matlab customer ka paisa aur uska access safe hai. Do options:
- Customer success page par "Email me a new link" dabaye, ya
- Aap `/api/resend-link` ko customer ke email se call karo (ya dashboard se manually phir se link bhejo).

---

## Local dev

```bash
cp .dev.vars.example .dev.vars   # phir asli TEST values daalo
npm run db:migrate:local
npm run dev                      # http://localhost:8787
```

`.dev.vars` gitignored hai — **kabhi commit mat karo**.

Frontend ko local backend se jodo (`js/config.js`):

```js
apiBaseUrl: 'http://localhost:8787',
```

### Local testing mein webhook

Razorpay `localhost` par webhook nahi bhejta ([blacklisted domains](https://razorpay.com/docs/webhooks/validate-test/) list ke hisaab se). Iske liye `cloudflared` tunnel use karo (ngrok blacklisted hai):

```bash
npm run deploy   # test mode keys ke saath deploy karna sabse aasan hai
```

Ya tunnel:

```bash
cloudflared tunnel --url http://localhost:8787
# jo https URL mile, wahi Razorpay webhook mein daalo
```

---

## Useful commands

```bash
npm run check          # sabhi src/*.js ka syntax check
npm run tail           # live production logs (errors debug karne ke liye)
npm run deploy         # production par push

npx wrangler d1 execute claude_course_db --remote --command "SELECT status, COUNT(*) FROM orders GROUP BY status"
npx wrangler d1 execute claude_course_db --remote --command "SELECT order_id, email_status, created_at FROM orders ORDER BY id DESC LIMIT 10"
npx wrangler d1 execute claude_course_db --remote --command "DELETE FROM tokens WHERE expires_at < (unixepoch('now')*1000 - 604800000)"
```

---

## Troubleshooting

| Problem | Kya dekhna hai |
|---------|----------------|
| `create-order` 502 deta hai | `RAZORPAY_KEY_ID`/`SECRET` secrets set hain? `npx wrangler tail` se error dekho. |
| Browser mein CORS error | `ALLOWED_ORIGINS` mein aapka exact origin hai? `https://` vs `http://` aur `www` ka farak matter karta hai. |
| `invalid_signature` | Test vs live keys mix ho gaye? Secret mein extra space hai? |
| Webhook 401 | `RAZORPAY_WEBHOOK_SECRET` wahi hai jo dashboard par set kiya? Secret badla to dashboard bhi update karo. |
| Webhook chal raha par email nahi | `RESEND_API_KEY` aur `EMAIL_FROM` check karo; `EMAIL_FROM` verified domain ka hona chahiye. `wrangler tail` dekho. |
| Download par 503 file_missing | R2 mein object key `PDF_OBJECT_KEY` se exactly match karti hai? Upar wala upload command dobara dekho. |
| Download 410 token_used | Token single-use hai. Customer "Email me a new link" dabaye — ye normal behaviour hai. |
| `database_reachable: false` | `wrangler.toml` mein `database_id` sahi hai? `npm run db:migrate` chalaya? |

---

## Kya abhi test nahi hua

Honest disclosure: is code ko **live payments ke saath test nahi kiya gaya**. Isse pehle ki aap real customer ko becho, section "Testing checklist" (main README mein) Razorpay **Test mode** keys ke saath pura chala lena. Tab tak payment/download system ko "working" maan lena galat hoga.
