# Solograph AI — Web Chatbot

Production stack: Node.js/TypeScript + Express backend, React frontend widget,
Groq (with OpenRouter fallback) API, PostgreSQL, Redis. Web-only — no
messaging platform integration.

Ask it a question in the chat widget, get an accurate, context-aware answer
in English. If it doesn't know something, it says so instead of
guessing.

---

## 1. Local Setup

```bash
# Backend
cd backend
cp .env.example .env      # fill in ANTHROPIC_API_KEY at minimum
npm install
npm run dev                # http://localhost:8080

# Frontend
cd ../frontend
npm install
npm run dev                # http://localhost:5173
```

Minimum to run locally: a Postgres and Redis instance. Easiest path:

```bash
docker compose up -d postgres redis
```

Then run `npm run dev` in `backend/` — it auto-creates the schema on boot.

Open http://localhost:5173 and start chatting.

---

## 2. Production Deployment (Docker)

```bash
cd chatbot
docker compose up -d --build
```

This starts backend + Postgres + Redis. Put the backend behind a reverse
proxy (Nginx/Caddy) with TLS, or deploy directly to:

- **Render / Railway / Fly.io** — point them at `backend/Dockerfile`,
  attach a managed Postgres + Redis, set env vars from `.env.example`.
- **AWS** — ECS Fargate (backend container) + RDS Postgres + ElastiCache
  Redis. Put an ALB in front for HTTPS.
- **GCP** — Cloud Run (backend) + Cloud SQL + Memorystore.

Frontend: build with `npm run build` in `frontend/` and deploy the static
`dist/` folder to Vercel/Netlify/Cloudflare Pages, or embed the widget
directly in your existing website.

**Required env vars in production:** `ANTHROPIC_API_KEY`, `DATABASE_URL`,
`REDIS_URL`, `ALLOWED_ORIGINS` (your website domain).

---

## 3. Embedding the Web Widget

Build the React app and load it in an iframe, mount it as a script on your
site, or wrap `<ChatWidget />` inside your existing React app. Set
`VITE_API_URL` to your deployed backend's `/api/chat` endpoint before
building:

```bash
VITE_API_URL=https://your-backend.com/api/chat npm run build
```

---

## 4. Loading the Knowledge Base

Simplest path (full-text search, works out of the box):

```sql
INSERT INTO kb_documents (title, content) VALUES
('Refund Policy', 'Refunds are processed within 5-7 business days...'),
('Business Hours', 'We are open Monday-Saturday, 8am-6pm WAT...');
```

For production-grade semantic search, wire up the commented Pinecone/Voyage
embedding code in `backend/src/services/knowledgeBase.ts` — swap
`retrieveContext` to call `vectorSearch` instead of the Postgres
full-text query.

---

## 5. Monitoring & Ops Notes

- `/health` endpoint for uptime checks / load balancer health probes.
- Structured JSON logs via Winston — pipe to Datadog/CloudWatch/Logtail.
- Rate limiting is IP-based on `/api/chat` (20 messages/minute by default,
  tune in `backend/src/middleware/rateLimit.ts`).
- `conversations.handed_off` flags conversations for human takeover —
  wire this into your support tooling (e.g. push to a Slack channel).

---

## 6. Installing as an App (PWA — Android/iOS/Desktop)

The frontend is already set up as an installable Progressive Web App —
no APK build, no app store. Once deployed:

**What you still need to do:**
1. Add real icon files at `frontend/public/icon-192.png` and
   `frontend/public/icon-512.png` (192×192 and 512×512 PNGs). Without
   these, the browser won't offer the install prompt.
2. Deploy as normal (Vercel/Netlify/etc.) — `manifest.json` and `sw.js`
   are served automatically from the `public/` folder.
3. **PWAs require HTTPS** to register a service worker (except on
   `localhost`) — any standard host (Vercel, Netlify, Railway) gives you
   this by default, so no extra setup needed there.

**How users install it:**
- **Android (Chrome)**: visit the site → Chrome shows an "Install app" /
  "Add to Home Screen" prompt automatically, or the user can trigger it
  via the browser menu (⋮ → Install app).
- **iOS (Safari)**: no auto-prompt — user taps Share → "Add to Home
  Screen" manually. This is an Apple platform limitation, not something
  fixable from the app side.
- **Desktop (Chrome/Edge)**: an install icon appears in the address bar.

Once installed, it opens full-screen with no browser chrome, has its own
home screen icon, and behaves like a native app — while still being the
exact same web app hitting the exact same backend.

---

## 7. Adding Messaging Channels Later

This build is web-only by design. If you later want WhatsApp, Telegram, or
Facebook Messenger support, each one is a self-contained adapter that reads
the incoming message, calls the same `handleUserMessage()` orchestrator used
by the web widget, and sends the reply back through that platform's API —
nothing in the core logic needs to change.
