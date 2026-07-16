// End-to-end exercise of the Amplify API: the full happy path
// (signup → click → conversion → approve → payout → paid) plus the guard
// rails (webhook idempotency, state-machine and role enforcement).
//
// Prerequisites: a running API that has been seeded (`npm run seed`) —
// the script logs in as the seeded admin/finance users.
// Run with: npm run smoke-test  (or: node scripts/smoke-test.mjs)
const BASE = process.env.SMOKE_BASE_URL || 'http://localhost:4000';
let passCount = 0;
let failCount = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${label} ${detail}`);
  }
}

async function api(path, { method = 'GET', token = null, bodyMap = null, raw = false } = {}) {
  const headersMap = { 'Content-Type': 'application/json' };
  if (token) headersMap.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: headersMap,
    body: bodyMap ? JSON.stringify(bodyMap) : null,
    redirect: 'manual',
  });
  const payload = raw ? await response.text() : await response.json().catch(() => null);
  return { status: response.status, payload, headersMap: response.headers };
}

// ---- 1. Affiliate signs up, gets a referral code instantly
const signup = await api('/api/auth/signup', {
  method: 'POST',
  bodyMap: { name: 'Test Runner', email: `runner-${Date.now()}@example.com`, password: 'Secret123' },
});
check('signup returns 201 + token + referral code', signup.status === 201 && signup.payload.token && signup.payload.userMap.referralCode);
const affiliateToken = signup.payload.token;
const refCode = signup.payload.userMap.referralCode;

// ---- 2. Someone clicks the share link
const click = await api(`/r/${refCode}`, { raw: true });
check('referral link redirects to store with ref', click.status === 302 && click.headersMap.get('location').includes(refCode));
const unknownClick = await api('/r/NOPE999', { raw: true });
check('unknown code still lands on store (unattributed)', unknownClick.status === 302 && unknownClick.headersMap.get('location') === '/store');

// ---- 3. They buy from the demo store
const checkout = await api('/api/store/checkout', {
  method: 'POST',
  bodyMap: { productId: 'terra-smartwatch', refCode },
});
check('storefront checkout records a commission', checkout.status === 201 && checkout.payload.commissionRecorded === true);

// ---- 4. External webhook + idempotent replay
const orderId = `EXT-${Date.now()}`;
const hook1 = await api('/api/webhooks/conversion', {
  method: 'POST',
  bodyMap: { externalOrderId: orderId, referralCode: refCode, orderAmountCents: 25000 },
});
check('webhook conversion recorded (2500c commission @10%)', hook1.status === 201 && hook1.payload.commissionAmountCents === 2500);
const hook2 = await api('/api/webhooks/conversion', {
  method: 'POST',
  bodyMap: { externalOrderId: orderId, referralCode: refCode, orderAmountCents: 25000 },
});
check('webhook replay is idempotent (duplicate, no 2nd commission)', hook2.status === 200 && hook2.payload.status === 'duplicate');
const hookBadRef = await api('/api/webhooks/conversion', {
  method: 'POST',
  bodyMap: { externalOrderId: `EXT2-${Date.now()}`, referralCode: 'NOPE999', orderAmountCents: 1000 },
});
check('webhook with unknown referral -> 422', hookBadRef.status === 422);

// ---- 5. Affiliate sees the earnings
const summary = await api('/api/me/summary', { token: affiliateToken });
check(
  'affiliate summary: 1 click, 2 conversions, pending = 1990+2500',
  summary.payload.clicksCount === 1 && summary.payload.conversionsCount === 2 && summary.payload.earningsMap.pendingCents === 4490
);

// ---- 6. Role guard: affiliate cannot touch admin API
const forbidden = await api('/api/admin/metrics', { token: affiliateToken });
check('affiliate blocked from admin API (403)', forbidden.status === 403);

// ---- 7. Admin reviews and approves
const adminLogin = await api('/api/auth/login', { method: 'POST', bodyMap: { email: 'admin@amplify.dev', password: 'Admin123!' } });
const adminToken = adminLogin.payload.token;
check('admin login', adminLogin.status === 200 && adminLogin.payload.userMap.role === 'admin');

const metrics = await api('/api/admin/metrics', { token: adminToken });
check('metrics endpoint returns totals', metrics.status === 200 && metrics.payload.affiliatesTotal >= 7 && metrics.payload.commissionTotalsMap.pending.count >= 2);

const pendingList = await api(`/api/admin/commissions?status=pending&limit=500`, { token: adminToken });
const runnerPendingList = pendingList.payload.commissionsList.filter((c) => c.affiliateName === 'Test Runner');
check('admin sees the 2 new pending commissions', runnerPendingList.length === 2);

const bulk = await api('/api/admin/commissions/bulk', {
  method: 'POST',
  token: adminToken,
  bodyMap: { commissionIds: runnerPendingList.map((c) => c.id), action: 'approve' },
});
check('bulk approve both', bulk.status === 200 && bulk.payload.updatedCount === 2 && bulk.payload.skippedList.length === 0);

const reApprove = await api(`/api/admin/commissions/${runnerPendingList[0].id}`, {
  method: 'PATCH',
  token: adminToken,
  bodyMap: { action: 'approve' },
});
check('state machine blocks approve->approve (400)', reApprove.status === 400);

// ---- 8. Finance runs the payout
const financeLogin = await api('/api/auth/login', { method: 'POST', bodyMap: { email: 'finance@amplify.dev', password: 'Finance123!' } });
const financeToken = financeLogin.payload.token;
check('finance login', financeLogin.status === 200 && financeLogin.payload.userMap.role === 'finance');

const financeApprove = await api(`/api/admin/commissions/${runnerPendingList[0].id}`, {
  method: 'PATCH',
  token: financeToken,
  bodyMap: { action: 'approve' },
});
check('finance cannot approve commissions (403)', financeApprove.status === 403);

const eligible = await api('/api/admin/payouts/eligible', { token: financeToken });
const runnerEligible = eligible.payload.eligibleList.find((e) => e.affiliateName === 'Test Runner');
check('Test Runner eligible for $44.90 payout', runnerEligible && runnerEligible.totalAmountCents === 4490 && runnerEligible.meetsMinimum);

const payout = await api('/api/admin/payouts', { method: 'POST', token: financeToken, bodyMap: { affiliateId: runnerEligible.affiliateId } });
check('payout batch created', payout.status === 201 && payout.payload.totalAmountCents === 4490);

const doublePayout = await api('/api/admin/payouts', { method: 'POST', token: financeToken, bodyMap: { affiliateId: runnerEligible.affiliateId } });
check('second batch for same balance blocked (400)', doublePayout.status === 400);

const markPaid = await api(`/api/admin/payouts/${payout.payload.id}/mark-paid`, {
  method: 'PATCH',
  token: financeToken,
  bodyMap: { paymentNote: 'UTR 12345' },
});
check('payout marked paid', markPaid.status === 200 && markPaid.payload.status === 'paid');

const csv = await api('/api/admin/payouts/export.csv?status=all', { token: financeToken, raw: true });
check('CSV export contains the batch', csv.status === 200 && csv.payload.includes('Test Runner') && csv.payload.includes('44.90'));

// ---- 9. Affiliate sees the money as paid
const summary2 = await api('/api/me/summary', { token: affiliateToken });
check('affiliate now shows 4490c paid, 0 pending', summary2.payload.earningsMap.paidCents === 4490 && summary2.payload.earningsMap.pendingCents === 0);

const myPayouts = await api('/api/me/payouts', { token: affiliateToken });
check('affiliate payout history shows the paid batch', myPayouts.payload.payoutsList.length === 1 && myPayouts.payload.payoutsList[0].status === 'paid');

// ---- 10. Audit trail
const paidCommission = await api(`/api/admin/commissions?affiliateId=${runnerEligible.affiliateId}`, { token: adminToken });
const historyList = paidCommission.payload.commissionsList[0].statusHistoryList;
check(
  'audit trail: pending->approved->processing->paid with actors',
  historyList.length === 4 && historyList[3].to === 'paid' && historyList[1].byName === 'Asha Verma' && historyList[3].byName === 'Rohit Iyer'
);

// ---- 11. Payout method
const method = await api('/api/me/payout-method', { method: 'PUT', token: affiliateToken, bodyMap: { method: 'upi', upiId: 'runner@okaxis' } });
check('affiliate saves payout method', method.status === 200 && method.payload.userMap.payoutMethodMap.upiId === 'runner@okaxis');
const badMethod = await api('/api/me/payout-method', { method: 'PUT', token: affiliateToken, bodyMap: { method: 'bank', accountName: 'X' } });
check('incomplete bank details rejected (400)', badMethod.status === 400);

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
