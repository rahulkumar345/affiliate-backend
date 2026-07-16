# The happy path, in 5 minutes

The whole product is one loop. This walks it end-to-end using the seeded demo data plus one live purchase. (This doubles as the Loom script.)

**Setup** (once): backend seeded & running, dashboard running, mobile app installed (APK) or open in Expo Go — see each repo's README.

## 1. The affiliate joins — and can share immediately *(problem 1: growth)*

On the phone, open **Amplify** → *Join the program* → name, email, password → **Create my referral link**.

> You land on Home with a referral code and share link already live — no approval queue, no waiting. That's the growth decision: joining takes 30 seconds.

Tap **Share** (or **Copy link**).

## 2. A customer buys through the link

Open the share link (`…/r/<CODE>`) in any browser. Two things just happened:

- the click was logged (watch **clicks** tick up on the app's Home after a pull-to-refresh),
- a 30-day attribution cookie was set.

You're now on **Acme Store** — the demo merchant, with a banner showing whose referral you arrived on. Buy the **Terra Smartwatch ($199)**.

> The store's checkout calls the same conversion service as the production webhook (`POST /api/webhooks/conversion`) — same idempotency, same commission math.

## 3. The affiliate sees it instantly

Back in the app → **Activity** (pull to refresh): a new commission, **+$19.90, pending** (10% of $199). Home now shows it in *Pending*.

## 4. The affiliate team reviews *(problem 2: reliable tracking)*

Dashboard → sign in as `admin@amplify.dev` / `Admin123!` → **Commissions** (defaults to the *pending* tab).

- The new $19.90 commission is at the top. Tick a few checkboxes → **bulk approve**, or approve just this one.
- Click **History** on any row: the full audit trail — created via storefront, approved by whom, when, with what note.
- Try approving it again — the state machine refuses. Replay the same order id at the webhook — you get `duplicate`, never a second commission.

## 5. Finance pays *(problem 3: payments)*

Sign in as `finance@amplify.dev` / `Finance123!` → **Payouts**.

- **Ready to pay** lists every affiliate whose approved balance clears the $10 minimum (our new affiliate needs a saved payment method — add it in the app under **Payouts → Add payment details**).
- **Create batch** → the approved commissions freeze into a payout with a reference (`PO-…`) and a snapshot of the payment details.
- **Export pending (CSV)** → this is the payment run finance executes in their banking portal.
- After paying, **Mark paid** (attach the UTR/transaction id).

## 6. The money shows up

App → **Payouts** (pull to refresh): the batch is there, **paid**, with date and amount. Home's *Paid* total updated. **Activity** shows the commission's final state.

That's the loop: **signup → share → click → order → pending → approved → batched → paid** — every hop visible to the affiliate, every state change audited for the team, and one clean file for finance.

---

### Bonus: prove the reliability claims (30 seconds, optional)

```bash
# same order id twice → second call is a no-op 'duplicate'
curl -X POST http://localhost:4000/api/webhooks/conversion \
  -H 'Content-Type: application/json' \
  -d '{"externalOrderId":"DEMO-1","referralCode":"PRIYA4KM","orderAmountCents":10000}'
curl -X POST http://localhost:4000/api/webhooks/conversion \
  -H 'Content-Type: application/json' \
  -d '{"externalOrderId":"DEMO-1","referralCode":"PRIYA4KM","orderAmountCents":10000}'

# or run all 26 end-to-end checks:
npm run smoke-test
```
