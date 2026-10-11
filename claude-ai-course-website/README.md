# Claude AI Video Editing Course — Complete Website Project

Ek **complete, production-ready** project: static frontend (GitHub Pages) + secure serverless backend (Cloudflare Worker) + private PDF storage (Cloudflare R2) + Razorpay payment verification + automatic email delivery.

> **Ye README Hinglish mein hai** — beginner-friendly. Technical shabd English mein hi rakhe hain (folder, file, deploy, secret) taaki aap unhe kahin bhi dhoondh sakein.

---

## 0. Pehle 3 minute mein samajh lo

Is project mein **teen alag-alag cheezein** hain. Inko mix mat karo:

| # | Kya hai | Kahan chalta hai | Kya rakhta hai |
|---|---------|------------------|----------------|
| 1 | **Frontend** (`index.html`, `css/`, `js/`, `pages/`) | GitHub Pages | Sirf design aur public information |
| 2 | **Backend** (`backend/`) | Cloudflare Workers | Sabse secrets: Razorpay key, webhook secret, email key |
| 3 | **PDF file** | Cloudflare R2 (private) | Course ka PDF — **kabhi GitHub par nahi** |

**Golden rule:** Secrets aur PDF **kabhi** frontend mein ya GitHub par nahi jayenge. Sirf Worker ke andar.

Aur ek zaroori baat: **payment hoti hai Razorpay par, par download tabhi milta hai jab hamara backend Razorpay se confirm kare.** Sirf "order success" page par pahunch jaana = payment ka proof nahi. Isi liye har payment server par signature + status + amount se verify hoti hai.

---

## 1. Folder structure

```
claude-ai-course-website/
├── index.html                     # Landing page (saare sections)
├── 404.html                       # Custom "page not found"
├── robots.txt                     # Search engine rules
├── sitemap.xml                    # SEO sitemap (domain badalna hai)
├── README.md                      # Ye file
├── .gitignore                     # Secrets aur PDF ko git se bahar rakhta hai
├── .nojekyll                      # GitHub Pages ko Jekyll band karne ke liye
├── CNAME.example                  # Custom domain ke liye template
│
├── assets/
│   ├── images/course-preview.svg  # Course ka illustrative preview (SVG)
│   └── icons/favicon.svg          # Browser tab icon
│
├── css/style.css                  # Poora design system (CSS3, mobile-first)
│
├── js/
│   ├── config.js                  # PUBLIC settings (koi secret nahi!)
│   ├── main.js                    # Menu, scroll, copy buttons, modal
│   ├── checkout.js                # Razorpay checkout + API calls
│   ├── success.js                 # Success / pending / failed pages ka logic
│   └── faq.js                     # Accessible FAQ accordion
│
├── pages/
│   ├── success.html               # Payment ke baad download
│   ├── payment-pending.html       # Payment pending
│   ├── payment-failed.html        # Payment fail
│   ├── privacy-policy.html
│   ├── terms.html
│   ├── refund-policy.html
│   └── contact.html
│
├── backend/                       # ⚠️ Ye GitHub Pages par deploy NAHI hota
│   ├── package.json
│   ├── wrangler.toml              # Public config + bindings
│   ├── .dev.vars.example          # Sirf placeholders (asli keys nahi)
│   ├── schema.sql                 # D1 database tables
│   ├── README.md                  # Backend ka detailed guide
│   └── src/
│       ├── index.js               # Router + saare routes
│       ├── razorpay.js            # Razorpay API + signature verification
│       ├── email.js               # Resend se download email
│       ├── storage.js             # Private R2 PDF
│       └── security.js            # HMAC, CORS, rate limit, helpers
│
└── .github/workflows/deploy.yml   # GitHub Pages auto-deploy
```

---

## 2. Kya kya accounts chahiye (external accounts)

Sab free se shuru ho sakte hain — sirf domain aur Razorpay account ka kharcha hai.

| # | Service | Kya kaam | Free? | Kya milega |
|---|---------|----------|-------|------------|
| 1 | **GitHub** | Frontend hosting (Pages) | Haan | Repository + Pages URL |
| 2 | **Cloudflare** | Worker + R2 + D1 | Haan (generous free tier) | Backend URL |
| 3 | **Razorpay** | Payment le na aur verify karna | Account free (per-transaction fee) | Key ID, Key Secret, Webhook Secret |
| 4 | **Resend** | Download email bhejna | Haan (limited free quota) | API key, verified sender domain |
| 5 | **Domain registrar** | Custom domain | Paid | DNS control panel |
| 6 | **VS Code** | Code edit karne ke liye | Haan | — |

**R2 note:** Cloudflare R2 activate karne ke liye dashboard mein ek baar payment method add karna padta hai, par 10 GB storage free tier ke andar aata hai — ek PDF ke liye practically ₹0.

---

## 3. Values jo aapko deni hain (checklist)

Ye cheezein sirf aap de sakte ho. Jab tak ye nahi milti, system test mode mein rahega.

### 3.1 Public values — `js/config.js` mein

| Value | Abhi kya hai | Aapko kya karna hai |
|-------|--------------|---------------------|
| `apiBaseUrl` | `https://claude-course-api.example.workers.dev` | Worker deploy karne ke baad apna real URL daalo |
| `supportEmail` | `support@example.com` | Apna real support email |
| `siteUrl` | `https://example.com` | Aapka domain |
| `pdfPageCount` | `''` (khaali) | **Sirf tab** jab aapko asli page count pata ho. Guess **mat** karo. |
| `priceInr` / `originalPriceInr` | 1449 / 4999 | Tabhi change karo jab asli ho |
| `paymentLinkUrl` | `https://rzp.io/rzp/30cJdSU` | Aapka existing Payment Link (fallback ke liye) |

### 3.2 Secret values — Cloudflare Worker mein (kabhi frontend mein nahi)

| Secret | Kahan se milega |
|--------|-----------------|
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Account & Settings → API Keys (test: `rzp_test_...`) |
| `RAZORPAY_KEY_SECRET` | Wahi jagah |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook banate waqt aap khud set karoge |
| `RESEND_API_KEY` | resend.com → API Keys |

### 3.3 Placeholders jo replace karne hain (grep se dhoondh lo)

```bash
grep -rn "example.com" . --include=*.html --include=*.js --include=*.xml --include=*.txt --include=*.toml
grep -rn "YOUR BUSINESS" . --include=*.html
```

- `https://example.com` → sitemap.xml, robots.txt, canonical/OG tags, `js/config.js`, `backend/wrangler.toml`
- `[YOUR BUSINESS NAME]`, `[YOUR BUSINESS ADDRESS]`, `[YOUR CITY, STATE]` → policy pages
- `support@example.com` → asli support email (frontend + backend dono mein)
- Legal pages ek **template** hain — launch se pehle review karwa lena.

---

## 4. Local par test karna (5 minute)

### 4.1 Frontend

`index.html` ko double-click karke kholna **kaam karega**, par sahi tareeka ek local server hai (warna kuch browser features block karte hain):

```bash
cd claude-ai-course-website

# Option A — Python (Windows/Mac/Linux par usually installed hota hai)
python3 -m http.server 8000

# Option B — Node (agar Node installed hai)
npx serve -l 8000
```

Phir browser mein kholo: `http://localhost:8000`

**Kya check karo:** menu khulta hai? Buy Now click par email form aata hai? FAQ accor-dion chalta hai? Copy buttons "Copied ✓" dikhate hain? Mobile view mein sticky CTA aata hai?

> Backend ke bina jab Buy Now dabao ge, "secure checkout unavailable" message aayega aur Payment Link fallback trigger hoga. Ye **expected** hai — API abhi local nahi chal rahi.

### 4.2 Backend (local dev)

```bash
cd backend
npm install                 # wrangler install karega (~1 min)

# D1 local database banao
npm run db:migrate:local

# secrets ke liye
cp .dev.vars.example .dev.vars    # phir .dev.vars kholein aur test values daalein

npm run dev                 # http://localhost:8787 par worker chalega
```

Doosre terminal mein test karo:

```bash
curl http://localhost:8787/api/health
```

`"ready": false` aa sakta hai agar PDF upload nahi hui — wo normal hai. Kam se kam dikhna chahiye: `razorpay_key_id: true`, `razorpay_key_secret: true`, `database_reachable: true`.

Local frontend ko local backend se jodne ke liye `js/config.js` mein:

```js
apiBaseUrl: 'http://localhost:8787',
```

…aur `backend/wrangler.toml` mein `ALLOWED_ORIGINS` mein `http://localhost:8000` already hai.

---

## 5. GitHub Pages par frontend deploy karna

### Step 1 — GitHub repository banao

1. github.com par login karo → **New repository**
2. Name: `claude-ai-course-website`
3. Visibility: **Public** (Pages ke liye simplest; private ke liye paid plan chahiye)
4. README/gitignore **add mat karo** (hamara apna hai) → **Create repository**

### Step 2 — Files push karo

Repository page par jo commands dikhengi, wahi use karo. Sabse aasan:

```bash
cd claude-ai-course-website
git init
git add .
git commit -m "Initial commit: Claude AI Video Editing Course website"
git branch -M main
git remote add origin https://github.com/<your-username>/claude-ai-course-website.git
git push -u origin main
```

> **Pehle ek baar check karo ki koi secret ya PDF git mein nahi ja rahi:**
> ```bash
> git status --short
> git ls-files | grep -Ei "\.pdf$|\.env$|\.dev\.vars$"
> ```
> Dono khaali aane chahiye (`.dev.vars` gitignored hai, `.dev.vars.example` jayega — wo theek hai).

### Step 3 — Pages enable karo

1. Repository → **Settings** → **Pages**
2. **Build and deployment → Source** = **GitHub Actions** ← ye zaroori hai
3. **Actions** tab kholo → "Deploy frontend to GitHub Pages" workflow chalna chahiye
4. 1–2 minute mein URL milega: `https://<your-username>.github.io/claude-ai-course-website/`

> Wor-kflow `backend/` ko **jaanbujh kar skip** karta hai, aur check bhi karta hai ki koi secret file site mein na aa jaye.

### Step 4 — Ek zaroori fix (custom domain use karo ya na karo)

Kyunki site `/<repo-name>/` path par serve hoti hai, `index.html` ke root-relative links tod sakte hain.

**Sabse safe solution: custom domain laga do (next step), tab site root `/` par chalegi aur sab kuch theek ho jayega.**

Bina domain test karne ke liye, temporary: `index.html` mein `assets/`, `css/`, `js/`, `pages/` waale relative paths ko `./` prefix se ya `python3 -m http.server` se local test karo. Custom domain lagane ke baad ye issue apne aap khatam ho jata hai.

---

## 6. Custom domain + DNS + HTTPS

### Step 1 — GitHub Pages mein domain daalo

Settings → **Pages** → **Custom domain** mein apna domain likho → **Save**.

Domain pehle **www** ke bina try karo (`yourdomain.com`), phir **www** version ke liye `www` CNAME banao jo root par redirect kare.

### Step 2 — Repo mein CNAME file banao

```bash
cp CNAME.example CNAME
# CNAME file kholo aur apna domain likho, e.g.:
# yourdomain.com
git add CNAME && git commit -m "Add custom domain" && git push
```

Ye file zaroori hai taaki deployment ke baad domain reset na ho.

### Step 3 — DNS records (domain provider ke panel mein)

**Root domain (`yourdomain.com`) ke liye — 4 A records:**

| Type | Name | Value |
|------|------|-------|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

**www ke liye — 1 CNAME record:**

| Type | Name | Value |
|------|------|-------|
| CNAME | `www` | `<your-username>.github.io` |

Purane A/AAAA records jo provider ne default diye honge, unhe **delete** kar do warna conflict hoga.

> Tips: DNS change hone mein 5 minute se 24 ghante lag sakte hain. Verify karo:
> ```bash
> dig yourdomain.com +short
> nslookup www.yourdomain.com
> ```

### Step 4 — HTTPS on karo

DNS theek hone ke baad: Settings → Pages → **Enforce HTTPS** ko tick karo. GitHub free SSL certificate khud de deta hai (kabhi 15–30 minute lagta hai). Tick nahi dikh raha? DNS detect hone ka wait karo.

### Step 5 — Verify

- `https://yourdomain.com` khulta hai aur **lock icon** dikhata hai
- `/pages/contact.html` jaise andar ke pages bhi khulte hain
- Mobile par bhi tez load hota hai

---

## 7. Backend deploy karna (Cloudflare Worker)

Pura detail `backend/README.md` mein hai. Short version:

```bash
cd backend
npm install
npx wrangler login                 # browser khulega, Cloudflare se login karo

# 1) D1 database banao, output se database_id copy karo
npm run db:create

# 2) wrangler.toml mein <your-d1-database-id> replace karo, phir:
npm run db:migrate

# 3) R2 bucket banao
npx wrangler r2 bucket create claude-course-private

# 4) Secrets daalo (ek-ek karke, prompt par value paste karo)
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY

# 5) Deploy
npm run deploy
```

Deploy ke baad URL milega, jaise:

```
https://claude-course-api.your-subdomain.workers.dev
```

### Frontend ko backend se jodo

`js/config.js`:

```js
apiBaseUrl: 'https://claude-course-api.your-subdomain.workers.dev',
```

Aur `backend/wrangler.toml` mein apna domain:

```toml
PUBLIC_SITE_URL = "https://yourdomain.com"
ALLOWED_ORIGINS = "https://yourdomain.com,https://www.yourdomain.com"
```

Badlav ke baad dobara `npm run deploy` (worker) aur `git push` (frontend).

---

## 8. Razorpay — sabse important hissa

### 8.1 Aapka existing Payment Link kyun primary flow nahi hai

Aapka link: `https://rzp.io/rzp/30cJdSU`

Maine [official Razorpay docs](https://razorpay.com/docs/payments/payment-links/) check ki. Problem ye hai:

Razorpay **Payment Links customers ko redirect/callback deti hain, par us callback par koi cryptographic signature nahi hoti.** Iska matlab browser se aane wale `?status=success` jaise parameter ko **payment ka proof nahi** maana ja sakta — koi bhi us URL ko manually khol sakta hai. Iske saath: Payment Link se aapko customer ka **email** reliably nahi milta, aur aapko **amount frontend se kabhi decide nahi karna** chahiye.

Isliye maine ye design kiya:

| Flow | Kaam | Kab use hota hai |
|------|------|------------------|
| **Standard Checkout + server order** (primary) | Razorpay order server par ₹1,449 = `144900` paise par fix. Payment ke baad `razorpay_signature` server par verify hoti hai, phir Razorpay API se status + amount confirm hota hai. Tab download token milta hai. | Normal case — hamesha yahi chalega |
| **Payment Link** (fallback only) | Sirf tab jab backend reachable na ho. Yahan hum jhooth nahi bolte: customer ko bataya jata hai ki payment ke baad apna **payment ID** support ko bhejna hoga. | Sirf emergency |

**Kya aapko naya checkout/payment link banana padega?** Checkout ke liye **naya Payment Link banane ki zaroorat nahi**. Standard Checkout Dashboard mein sirf **API keys** chahiye (jo aapke account mein already available hain). Haan, agar aap chahein ki customer ka email hamesha aap tak pahunche, to existing Payment Link ki jagah ye checkout flow use karna hi behtar hai — kyunki isme customer email hamare modal se liya jata hai aur order notes mein attach hota hai.

### 8.2 Razorpay setup (step by step)

**A. API keys lo**

1. [Razorpay Dashboard](https://dashboard.razorpay.com) → login
2. **Account & Settings → API Keys → Generate Key**
3. **Test mode** ka toggle ON karke pehle test keys lo (`rzp_test_...`)
4. Key Secret **sirf ek baar dikhta hai** — turant safe jagah save karo (password manager)

**B. Backend par secrets daalo**

```bash
cd backend
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
```

**C. Test mode keys ke saath deploy karo, phir test karo** (section 11 dekho). Sab theek chale to:

**D. Live keys lo** — Dashboard mein Live mode ON karo → naye live keys generate karo (`rzp_live_...`) → wahi `wrangler secret put` commands dobara chalao → `npm run deploy`

> ⚠️ Live aur test keys **kabhi mix na karo**. Mix karne se signature verification fail hoti hai.

### 8.3 Webhook setup (yahi asli safety net hai)

Webhook ka fayda: agar customer payment ke baad browser band kar de, to bhi Razorpay hamare server ko batayega → order record hoga → email chala jayega.

1. Razorpay Dashboard → **Account & Settings → Webhooks → Add New Webhook**
2. **Webhook URL:**
   ```
   https://claude-course-api.your-subdomain.workers.dev/api/webhook/razorpay
   ```
   (Test mode ke liye Test ke tab mein, Live ke liye Live ke tab mein — dono jagah add karna padega)
3. **Secret:** koi lamba random string daalo (jaise 32+ characters). **Ise copy karke rakh lo.**
4. **Active Events** — ye zaroori events select karo:
   - ✅ `payment.captured`
   - ✅ `order.paid`
5. **Add Webhook** → phir secret backend mein daalo:
   ```bash
   npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
   npm run deploy
   ```
6. **Test karo:** Dashboard ke webhook page par **Test Webhook** / resend option se event bhejo. Worker logs mein dekho:
   ```bash
   npm run tail
   ```
   `webhook_invalid_signature` aaye to secret galat hai. `webhook_processed` aaye to sab theek hai.

> **Secret badla to dono jagah badlo** — Razorpay dashboard aur Cloudflare secret. Purane retry events ke liye Razorpay purana secret use karta hai, isliye ek din ke liye logs check karte rehna.

### 8.4 Amount change karna ho to

Do jagah badlo — dono match karni chahiye:
- `backend/src/security.js` → `EXPECTED_AMOUNT_PAISE = 144900`
- `backend/wrangler.toml` → `EXPECTED_AMOUNT = "144900"` (documentation ke liye)

Frontend ki price sirf **display** ke liye hai (`js/config.js`) — usse payment amount nahi banta.

---

## 9. PDF ko private storage mein upload karna

Aapke paas course PDF ready hai. Use **kabhi** `assets/` mein ya GitHub par na daalein — warna woh `https://yourdomain.com/…pdf` par public ho jayegi aur koi bhi bina paise download kar lega.

```bash
cd backend

# object key aur PDF_OBJECT_KEY (wrangler.toml) same honi chahiye
npx wrangler r2 object put claude-course-private/private/claude-ai-video-editing-course.pdf \
  --file="/full/path/to/your-course.pdf"
```

Verify karo:

```bash
curl -s https://claude-course-api.your-subdomain.workers.dev/api/health
# "pdf_present_in_r2": true  aur  "pdf_size_bytes": <aapki file ka size> dikhna chahiye
```

**File naam badalna ho** to `PDF_FILENAME` (customer ko milne wala naam) badlo — `PDF_OBJECT_KEY` (storage ka path) se alag hai.

**Kyunki bucket private hai:** file ka koi public URL exist nahi karta. Sirf `/api/download?t=<token>` se milti hai, aur us token ke liye verified payment chahiye.

---

## 10. Email delivery setup (Resend)

1. [resend.com](https://resend.com) par account banao → **API Keys → Create API Key** → key copy karo
2. Backend secret mein daalo:
   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```
3. **Domains → Add Domain** → apna domain daalo
4. Jo **SPF / DKIM / DMARC** DNS records dikhein, wo domain provider ke DNS panel mein add karo
5. Verified hone ke baad `backend/wrangler.toml`:
   ```toml
   EMAIL_FROM = "Claude AI Course <no-reply@yourdomain.com>"
   SUPPORT_EMAIL = "your-real-support@yourdomain.com"
   ```
6. `npm run deploy`

**Testing tip:** domain verify hone se pehle Resend sirf `onboarding@resend.dev` se aapke hi account email par bhejne deta hai. Isliye pehle test ke liye `EMAIL_FROM = Claude AI Course <onboarding@resend.dev>` use karo, production ke liye apna domain.

**Email fail ho jaye to?** Ghabrane ki baat nahi — order `orders` table mein record ho chuka hota hai (`email_status` = failed). Customer success page par **"Email me a new link"** daba sakta hai, ya aap support se manually bhej sakte ho. Customer ka paisa aur uska access safe rehta hai.

---

## 11. Testing checklist (launch se pehle)

Maine ye code **Razorpay Test mode** ke saath chalana chahiye — abhi tak live payment se verify **nahi** hua. Neeche wala checklist pura karo, tab hi live jao.

### 11.1 Test credentials

- Razorpay Dashboard → **Test mode** ON karo
- Test keys Worker secrets mein daalo (`rzp_test_...`)
- Razorpay ke test cards use karo, aur test UPI se payment karo

### 11.2 Frontend checks

| # | Test | Expected result |
|---|------|-----------------|
| 1 | Desktop (1920px) + laptop layout | Sections theek, koi overflow nahi |
| 2 | Mobile 360px width | Sticky bottom CTA aata hai, text readable, buttons 44px+ |
| 3 | Tablet 768px | Grid 2 columns ho jata hai |
| 4 | Sirf keyboard se Tab karo | Har link/button par visible focus ring, modal mein focus trap |
| 5 | Navigation links (What you'll learn, FAQ, Pricing, Contact) | Sahi section par smooth scroll |
| 6 | FAQ accordion | Ek baar mein ek khulta hai, aria-expanded sahi |
| 7 | Copy prompt buttons | "Copied ✓" dikhta hai, clipboard mein sahi text |
| 8 | Price har jagah | **₹1,449** aur **₹4,999** consistent |
| 9 | Backend band karke Buy Now | "checkout unavailable" message + Payment Link fallback (jhooth nahi bolta) |
| 10 | Browser console | Koi error nahi |

### 11.3 Payment tests

| # | Test | Expected result |
|---|------|-----------------|
| 11 | Test card se successful payment (₹1,449) | Success page par download button; email bhi aata hai |
| 12 | Success page ka **download button** | PDF download hota hai, file khulti hai |
| 13 | Wahi link **dobara** kholo | 410 / "link already used" message |
| 14 | Payment window band kar do (cancel) | Pending page; **koi download nahi** |
| 15 | Fail hone wala test card | Failed page; **koi download nahi**, koi email nahi |
| 16 | Failure wale card ka test karo | Razorpay `payment.failed` handle hua |
| 17 | Test UPI se payment | Pending → success transition sahi |
| 18 | Server par amount check | Razorpay this 144900 paise; koi doosri amount accept nahi hoti |

### 11.4 Security tests (ye sabse zaroori hain)

| # | Test | Kaise | Expected |
|---|------|-------|----------|
| 19 | **Invalid signature** | `curl -X POST .../api/verify-payment -H 'Content-Type: application/json' -d '{"razorpay_order_id":"order_FAKE","razorpay_payment_id":"pay_FAKE","razorpay_signature":"deadbeef"}'` | `400`, `invalid_signature`, koi token nahi |
| 20 | **Fake order_id ke saath order-status** | `{"order_id":"order_FAKE"}` | `found: false`, `paid: false`, koi token nahi |
| 21 | **Invalid webhook signature** | Body bhejo bina `X-Razorpay-Signature` ke | `401 invalid_webhook_signature` |
| 22 | **Duplicate webhook event** | Wahi `x-razorpay-event-id` dobara bhejo | `{"duplicate": true}`, dobara email nahi |
| 23 | **Expired token** | D1 mein `UPDATE tokens SET expires_at = 0 WHERE token = '<t>'` phir download | `410 token_expired` |
| 24 | **Reused token** | Ek baar download, phir wahi URL | `410 token_used` |
| 25 | **Bina token PDF** | `curl .../api/download` | `401 missing_token` |
| 26 | **PDF GitHub par hai?** | Browser: `https://yourdomain.com/assets/images/course-preview.pdf` | 404 — koi PDF site par nahi |
| 27 | **R2 public hai?** | `npx wrangler r2 bucket dev-url get claude-course-private` | Error — public URL off |
| 28 | **Rate limit** | `create-order` 16 baar | 16th par `429 rate_limited` |
| 29 | **CORS** | Doosre origin se API call | Origin header nahi milega |
| 30 | **Secret leak check** | `grep -rn "rzp_live\|RAZORPAY_KEY_SECRET" . --exclude-dir=.git` | Sirf placeholders, koi real key nahi |

### 11.5 Email tests

| # | Test | Expected |
|---|------|----------|
| 31 | Successful payment ke baad inbox | Download email aaya, link chalta hai |
| 32 | Email ka link ek baar chalao | Download hota hai; dusri baar 410 |
| 33 | **Galti se email address** daal kar pay karo | Order record hota hai, `email_status` = `failed`/`bounced`; support manually deliver kar sakta hai |
| 34 | **Email provider key hatakar** test | Order `paid` rehta hai, `email_status` = `email_not_configured`; customer success page se download kar leta hai |
| 35 | "Email me a new link" on success page | Naya token + email aata hai |
| 36 | "Email me a new link" on pending page (unpaid) | Generic message, koi email nahi (order verified nahi) |
| 37 | Same email 6 baar resend | 6th par 429 |

### 11.6 Deployment tests

| # | Test | Expected |
|---|------|----------|
| 38 | GitHub Actions workflow | Green tick, deploy success |
| 39 | Pages par ANDAR ke pages refresh karo (`/pages/contact.html`) | Page load hota hai, 404 nahi |
| 40 | Galat URL kholo | Custom `404.html` dikhta hai |
| 41 | Custom domain | `https://yourdomain.com` khulta, lock icon |
| 42 | `http://` → `https://` | Redirect ho jata hai |
| 43 | `www` vs non-`www` | Jo aapne choose kiya wahi canonical |
| 44 | Sitemap | `https://yourdomain.com/sitemap.xml` khulta hai, URLs aapke domain ke |
| 45 | robots.txt | `https://yourdomain.com/robots.txt` khulta hai |

---

## 12. Launch checklist (baad ke steps)

- [ ] Saare 45 tests pass hue
- [ ] Razorpay **live mode** keys generate karke secrets update kiye
- [ ] Live mode webhook URL add kiya + `RAZORPAY_WEBHOOK_SECRET` update kiya
- [ ] `PUBLIC_SITE_URL` aur `ALLOWED_ORIGINS` mein real domain daala (www + non-www dono)
- [ ] PDF R2 mein private upload ki — file size `/api/health` se confirm kiya
- [ ] Resend domain verified, `EMAIL_FROM` us domain ka
- [ ] `/api/health` par **`ready: true`**
- [ ] Support email monitor ho raha hai
- [ ] Legal pages par placeholders replace kiye (business name, address, city)
- [ ] `js/config.js` mein `pdfPageCount` set kiya (agar aapko asli count pata hai) — warna khaali chhodo
- [ ] `sitemap.xml` aur `robots.txt` mein domain update kiya
- [ ] Ek real ₹1 payment **apne aap** se karke pura flow test kiya (aur refund kar diya)
- [ ] Google Search Console mein sitemap submit kiya

---

## 13. Exact commands (copy-paste ready)

### Frontend local test

```bash
cd claude-ai-course-website
python3 -m http.server 8000
# browser: http://localhost:8000
```

### Backend local + first deploy

```bash
cd claude-ai-course-website/backend
npm install
npx wrangler login
npm run db:create
# wrangler.toml mein <your-d1-database-id> replace karo
npm run db:migrate
npx wrangler r2 bucket create claude-course-private
npx wrangler r2 object put claude-course-private/private/claude-ai-video-editing-course.pdf --file="/full/path/to/your-course.pdf"
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
npx wrangler secret put RESEND_API_KEY
npm run check
npm run deploy
curl https://claude-course-api.your-subdomain.workers.dev/api/health
```

### GitHub par push

```bash
cd claude-ai-course-website
git init && git add . && git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<user>/claude-ai-course-website.git
git push -u origin main
```

### Ye code khud check karna

```bash
# JS syntax
for f in js/*.js backend/src/*.js; do node --check "$f"; done

# Koi secret commit mein aa gaya?
git ls-files | grep -Ei "\.pdf$|\.env$|\.dev\.vars$"

# Frontend mein secret leak?
grep -rn "rzp_live_\|RAZORPAY_KEY_SECRET\s*=" js/ pages/ index.html
```

### Logs aur database

```bash
cd backend
npm run tail
npx wrangler d1 execute claude_course_db --remote --command "SELECT status, COUNT(*) FROM orders GROUP BY status"
npx wrangler d1 execute claude_course_db --remote --command "SELECT order_id, email_status, created_at FROM orders ORDER BY id DESC LIMIT 10"
```

---

## 14. Honest limitations (jhooth nahi bolunga)

1. **Live payments se test nahi hua.** Code Razorpay test mode ke liye likha gaya hai; section 11 ka checklist pura karke hi live jao.
2. **Ek download link ek baar chalta hai.** Ye security ke liye hai. Customer ke paas support ka option hai — dobara link free milta hai, dobara paisa nahi.
3. **Kuch email providers pure "bounce" ka pata nahi dete.** Isliye `email_status` sirf provider ka response dikhata hai; asli delivery buyer ke inbox par depend karti hai. Support flow isliye zaroori hai.
4. **PDF ka page count display nahi hota** jab tak aap `pdfPageCount` set na karo. Maine koi number invent nahi kiya.
5. **Testimonials, reviews aur customer counts nahi hain** — kyunki aapne genuine reviews diye nahi. Us jagah ek factual "Course overview" section hai. Fake ratings se aapka Razorpay account risk mein aa sakta hai.
6. **`/api/health` publicly accessible hai.** Ye sirf booleans deta hai (config ready hai ya nahi), koi secret nahi. Chahein to ise ek `HEALTH_TOKEN` se bhi protect kar sakte hain.
7. **Legal pages template hain.** Business name, address, refund terms apne hisaab se review karwa lena — ye legal advice nahi hai.
8. **`www` vs non-`www`:** GitHub Pages mein ek primary domain set karo. Dono ko ek saath full site ke roop mein use na karo, warna SEO duplicate ho jayega.
9. **Legal note (Razorpay):** Razorpay ko digital goods bechne ke liye KYC aur sahi business details chahiye. Payment Page/Link par refund policy link public honi chahiye — aapki `/pages/refund-policy.html` already ready hai.

---

## 15. Quick reference — kaun si file kya karti hai

| File | Kaam | Secret hai? |
|------|------|-------------|
| `js/config.js` | Public settings (price, API URL, support email) | ❌ Public — koi secret nahi |
| `js/checkout.js` | Razorpay checkout kholta hai, API call karta hai | ❌ Public |
| `js/success.js` | Status pages ka logic, token se download | ❌ Public |
| `backend/src/index.js` | Saare API routes | ✅ Worker par |
| `backend/src/razorpay.js` | Signature + payment verification | ✅ Worker par |
| `backend/src/email.js` | Download email | ✅ Worker par |
| `backend/src/storage.js` | Private R2 PDF | ✅ Worker par |
| `backend/src/security.js` | HMAC, CORS, rate limit | ✅ Worker par |
| `backend/wrangler.toml` | Public config + bindings | ❌ Public (secrets nahi) |
| `backend/.dev.vars` | Local secrets | ✅ Gitignored |
| Aapki course PDF | Product | ✅ Sirf R2 (private) |

---

## 16. Support aur next steps

**Agar kuch atak jaye:**
1. `npm run tail` se backend logs dekho — asli error wahin milega
2. `/api/health` kholo — koi config missing hai to wohi dikhayega
3. Browser DevTools → Network tab — CORS ya 4xx/5xx wahin dikhega

**Aage kya kar sakte ho (optional):**
- Ek chhota admin page jo `/api/order-status` se order lookup kare (support ke liye)
- Cron Trigger se purane tokens/webhook logs auto-clean karna (`schema.sql` ke neeche queries di hui hain)
- R2 se PDF ke liye **signed URL** ki jagah hamesha token flow hi use karo — ye zyada safe hai
- Multiple licences ya bundle pricing ke liye `EXPECTED_AMOUNT_PAISE` ko request ke hisaab se decide karo (server par, frontend se nahi)

---

**Ek line mein:** frontend GitHub Pages par, backend Cloudflare Worker par, PDF private R2 mein, aur har download ek verified Razorpay payment ke baad hi milta hai.

