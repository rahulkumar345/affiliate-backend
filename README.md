# Amplify — Affiliate Program Backend

The API and engine behind **Amplify**, a v1 affiliate-program product built for three problems:

1. **Get more people to sign up** → signup is instant and self-serve from the mobile app; a referral link is live within seconds.
2. **The affiliate team can't track/release commissions reliably** → idempotent conversion ingestion + an explicit commission state machine with a full audit trail.
3. **Finance struggles to make payments** → approved commissions batch into payout runs with a CSV export and a snapshot of payment details.

This is one of three repos:

| Repo | What it is |
|---|---|
| **[affiliate-backend](https://github.com/rahulkumar345/affiliate-backend)** (this repo) | Node/Express/MongoDB API, referral tracking, commission engine, payouts, demo storefront |
| [affiliate-dashboard](https://github.com/rahulkumar345/affiliate-dashboard) | Back-office web app for the affiliate & finance teams (React + Vite) |
| [affiliate-app](https://github.com/rahulkumar345/affiliate-app) | Affiliate-facing mobile app (React Native / Expo) |

## How the pieces talk

```
┌──────────────────┐         ┌───────────────────────────┐
│  affiliate-app   │         │   affiliate-dashboard     │
│  (React Native)  │         │   (React + Vite, web)     │
└────────┬─────────┘         └─────────────┬─────────────┘
         │        REST / JSON over JWT     │
         ▼                                 ▼
┌─────────────────────────────────────────────────────────┐
│               affiliate-backend (this repo)             │
│   /api/*  · /r/:code referral redirect · /store demo    │
│   commission state machine · payout batches · CSV       │
└────────────────────────────┬────────────────────────────┘
                             ▼
                          MongoDB
```

- The **dashboard** reads the API base URL from `VITE_API_URL`.
- The **mobile app** reads it from `app.json → expo.extra.apiUrl`, overridable at runtime on the login screen (no rebuild needed).
- Affiliate share links point at **this** backend: `<BASE_URL>/r/<CODE>` → click is logged → demo storefront → purchase → conversion webhook → commission.

**Startup order:** MongoDB → this backend (`npm run seed` once, then `npm start`) → dashboard / app.

## Quickstart

Prereqs: Node 18+, and MongoDB (any of: local install, Docker, or an Atlas URI).

```bash
# 1. MongoDB (skip if you already have one)
docker run -d --name amplify-mongo -p 27017:27017 mongo:7

# 2. Install & configure
npm install
cp .env.example .env          # defaults work for local dev

# 3. Seed demo data (6 affiliates, 30 conversions, payouts in every state)
npm run seed

# 4. Run
npm start                     # or: npm run dev (watch mode)
```

The API is now on `http://localhost:4000`. Verify with the smoke test (starts nothing, just exercises the running API):

```bash
npm run smoke-test            # 26 end-to-end checks: happy path + guard rails
```

### Demo credentials (created by the seed)

| Who | Email | Password | Where |
|---|---|---|---|
| Affiliate team (admin) | `admin@amplify.dev` | `Admin123!` | dashboard |
| Finance team | `finance@amplify.dev` | `Finance123!` | dashboard |
| Affiliate (active) | `priya@example.com` | `Affiliate123!` | mobile app |
| Affiliate (brand new) | `leo@example.com` | `Affiliate123!` | mobile app |

## The core loop

**Affiliate signs up → shares link → customer buys → commission tracked → team approves → finance pays → affiliate sees money.**

Because there's no real merchant in a take-home assignment, the backend ships a tiny demo store (**Acme Store**, at `/store`). The referral link `/r/:code` logs the click, drops a 30-day attribution cookie, and lands on the store; the store's checkout records the conversion **through the exact same service** as the production webhook (`POST /api/webhooks/conversion`), so the demo path and the real-merchant path are one code path.

## API surface

| Method & path | Auth | What it does |
|---|---|---|
| `POST /api/auth/signup` | — | Affiliate signup; referral code issued instantly |
| `POST /api/auth/login` | — | Login (all roles), returns JWT |
| `GET /api/me/summary` | affiliate | Earnings by status, clicks, conversions, share URL |
| `GET /api/me/commissions` · `GET /api/me/payouts` | affiliate | Own history |
| `PUT /api/me/payout-method` | affiliate | Save UPI / bank / PayPal details |
| `GET /r/:code` | — | Click tracking + redirect to store |
| `GET /store` · `POST /api/store/checkout` | — | Demo merchant |
| `POST /api/webhooks/conversion` | secret header* | Idempotent conversion ingestion (the merchant contract) |
| `GET /api/admin/metrics` · `/affiliates` · `/commissions` · `/payouts` | admin, finance | Program views |
| `PATCH /api/admin/commissions/:id` · `POST /api/admin/commissions/bulk` | **admin** | Approve / reject (single + bulk) |
| `GET /api/admin/payouts/eligible` · `POST /api/admin/payouts` | admin, finance | Balances ready to pay → create batch |
| `PATCH /api/admin/payouts/:id/mark-paid` | admin, finance | Finalize a batch |
| `GET /api/admin/payouts/export.csv?status=pending` | admin, finance | The payment-run file finance works from |
| `GET/PUT /api/admin/config` | view both / edit **admin** | Commission rate, minimum payout |

\* only enforced when `WEBHOOK_SECRET` is set.

## Commission lifecycle

```
            ┌──────────┐  admin   ┌──────────┐  payout batch  ┌────────────┐  mark paid  ┌──────┐
conversion →│ pending  │─────────▶│ approved │───────────────▶│ processing │────────────▶│ paid │
            └────┬─────┘          └──────────┘   (finance)    └────────────┘  (finance)  └──────┘
                 │ admin
                 ▼
            ┌──────────┐
            │ rejected │   (terminal)
            └──────────┘
```

Rules the engine enforces (see `src/services/commissionService.js`):

- Transitions not in the map above are **impossible** — a paid commission can't be re-approved, a rejected one can't be paid.
- Every transition appends an immutable audit entry: from, to, **who**, when, note.
- A conversion's `externalOrderId` has a unique index — replaying the same order (webhook retries, double-clicks) can **never** create a second commission.
- Payout batches snapshot the affiliate's payment details at creation time, so the exported payment run stays valid even if the affiliate edits their details mid-run.
- All money is integer cents. No floats, ever.

## What I chose for v1 (and why)

- **Auto-approve affiliates, manually approve commissions.** Problem 1 is growth — an affiliate-approval queue is signup friction, so there isn't one. Problem 2 is money-reliability — so a human gate sits *before money moves*, not before people join.
- **Idempotency + audit trail over feature count.** "Track and release reliably" is fundamentally about trust in the numbers. The unique-order-id constraint, the state machine, and the per-change audit log are the smallest set of mechanisms that make the numbers trustworthy.
- **Payout batches with CSV export, not a payments integration.** Finance teams already have a way to move money; what they lack is a clean, frozen, per-affiliate payment run with details attached and a way to reconcile it back ("mark paid"). A real payment rail (Razorpay Payouts / PayPal) slots in behind the same batch model later.
- **A demo storefront in the backend.** Cheap (~one file), and it turns the whole system from an abstract API into a loop you can feel: tap share → buy → watch the commission appear.

## Tradeoffs I accepted for the timebox

- **No multi-document transactions.** Conversion + commission are two writes; a crash between them could leave a conversion without a commission. Real deployment: Mongo replica-set transactions (Atlas supports them out of the box) or an outbox pattern.
- **JWT without refresh tokens/rotation**; 7-day expiry.
- **Click tracking is naive** — no bot filtering, no dedup by IP/device. Counts are directional, not billable.
- **No pagination** beyond sensible `limit`s (fine at demo scale).
- **Single global commission rate** (editable in Settings); no per-affiliate tiers.

## What I'd do next

1. **Hold period / auto-release** — commissions auto-approve N days after the return window closes; the manual gate becomes exception-handling instead of routine work.
2. **Real payment rail** — Razorpay Payouts / PayPal integration driven by the same batch model, with webhook-confirmed `paid` transitions.
3. **Fraud signals** — self-referral detection (email/IP/device match between affiliate and buyer), velocity alerts, click dedup.
4. **Affiliate lifecycle** — optional KYC before first payout, suspension, per-affiliate rates and tiered incentives.
5. **Notifications** — push/email on approval and payment (the retention loop for problem 1).
6. **Hardening** — unit tests around the state machine (the smoke test covers it end-to-end today), rate limiting on public endpoints, structured logging, request idempotency keys on payout mutations.

## Configuration

All config is via environment variables — see [.env.example](.env.example):

| Var | Purpose | Default |
|---|---|---|
| `PORT` | API port | `4000` |
| `MONGODB_URI` | Mongo connection string | `mongodb://localhost:27017/amplify` |
| `JWT_SECRET` | JWT signing secret | — (required) |
| `BASE_URL` | Public URL of this backend; used to build share links | `http://localhost:4000` |
| `WEBHOOK_SECRET` | If set, `POST /api/webhooks/conversion` requires it in `x-webhook-secret` | disabled |

## Deploying (Render + Atlas, both free tiers)

1. Create a free MongoDB Atlas cluster; copy the connection string.
2. On Render: **New → Blueprint**, point at this repo (`render.yaml` is included), set `MONGODB_URI` and `BASE_URL` (the service's own public URL).
3. Seed once from your machine: `MONGODB_URI='<atlas-uri>' npm run seed`.
4. Point the dashboard's `VITE_API_URL` and the app's `expo.extra.apiUrl` at the Render URL.

## Repo layout

```
src/
  app.js               express wiring
  server.js            entrypoint
  models/              User, Click, Conversion, Commission, Payout, ProgramConfig
  routes/              auth, me, tracking (+store), webhooks, admin
  services/            commissionService (state machine), conversionService, payoutService
  middleware/          JWT auth, roles, error handling
  views/storePage.js   the Acme Store demo merchant
  seed/seed.js         deterministic demo dataset
scripts/
  smoke-test.mjs       26 end-to-end checks against a running seeded API
```

See [WALKTHROUGH.md](WALKTHROUGH.md) for the 5-minute happy-path demo script.
