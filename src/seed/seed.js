import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { Click } from '../models/Click.js';
import { Conversion } from '../models/Conversion.js';
import { Commission } from '../models/Commission.js';
import { Payout } from '../models/Payout.js';
import { ProgramConfig } from '../models/ProgramConfig.js';

// Deterministic PRNG so every seed run produces the same believable dataset
function mulberry32(seedInt) {
  let state = seedInt;
  return function () {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(42);
const randomInt = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (itemsList) => itemsList[randomInt(0, itemsList.length - 1)];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS - randomInt(0, 23) * HOUR_MS);

const ORDER_AMOUNTS_LIST = [12900, 19900, 5900]; // matches the Acme Store catalog
const RATE_PERCENT = 10;

// name / email / code / payout method / joined N days ago / clicks / commission statuses
const AFFILIATES_LIST = [
  {
    name: 'Priya Sharma', email: 'priya@example.com', code: 'PRIYA4KM',
    methodMap: { method: 'upi', upiId: 'priya@okhdfc' }, joinedDaysAgo: 38, clicksCount: 62,
    commissionStatusesList: ['paid', 'paid', 'paid', 'paid', 'approved', 'approved', 'approved', 'pending', 'pending', 'rejected'],
  },
  {
    name: 'Arjun Mehta', email: 'arjun@example.com', code: 'ARJUN7TQ',
    methodMap: { method: 'bank', accountName: 'Arjun Mehta', accountNumber: '50100223344556', ifsc: 'HDFC0001234' },
    joinedDaysAgo: 31, clicksCount: 47,
    commissionStatusesList: ['processing', 'processing', 'processing', 'processing', 'approved', 'approved', 'pending', 'pending'],
  },
  {
    name: 'Sara Ali', email: 'sara@example.com', code: 'SARAA2VX',
    methodMap: { method: 'paypal', paypalEmail: 'sara.ali@example.com' }, joinedDaysAgo: 24, clicksCount: 33,
    commissionStatusesList: ['paid', 'paid', 'approved', 'approved', 'pending', 'rejected'],
  },
  {
    name: 'Dev Patel', email: 'dev@example.com', code: 'DEVPA9RN',
    methodMap: { method: 'upi', upiId: 'devp@okicici' }, joinedDaysAgo: 16, clicksCount: 21,
    commissionStatusesList: ['approved', 'approved', 'pending', 'pending'],
  },
  {
    name: 'Maya Rao', email: 'maya@example.com', code: 'MAYAR5ZW',
    methodMap: null, joinedDaysAgo: 6, clicksCount: 11, // no payout method yet — exercises that path
    commissionStatusesList: ['approved', 'pending'],
  },
  {
    name: 'Leo Fernandes', email: 'leo@example.com', code: 'LEOFE8JD',
    methodMap: null, joinedDaysAgo: 2, clicksCount: 4, // brand new, no conversions yet
    commissionStatusesList: [],
  },
];

// How far back a conversion is created, per final status, so its full history fits before "now"
const CREATED_DAYS_BACK_MAP = {
  paid: [12, 22],
  processing: [5, 9],
  approved: [2, 8],
  pending: [0, 4],
  rejected: [4, 14],
};

const REJECTION_NOTES_LIST = ['Order returned by customer', 'Self-purchase — against program terms'];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/amplify');
  console.log('Connected. Wiping existing data…');
  await Promise.all([
    User.deleteMany({}),
    Click.deleteMany({}),
    Conversion.deleteMany({}),
    Commission.deleteMany({}),
    Payout.deleteMany({}),
    ProgramConfig.deleteMany({}),
  ]);

  await ProgramConfig.create({ key: 'global', commissionRatePercent: RATE_PERCENT, minPayoutCents: 1000 });

  const passwordHashMap = {
    admin: await bcrypt.hash('Admin123!', 10),
    finance: await bcrypt.hash('Finance123!', 10),
    affiliate: await bcrypt.hash('Affiliate123!', 10),
  };

  const admin = await User.create({ name: 'Asha Verma', email: 'admin@amplify.dev', passwordHash: passwordHashMap.admin, role: 'admin' });
  const finance = await User.create({ name: 'Rohit Iyer', email: 'finance@amplify.dev', passwordHash: passwordHashMap.finance, role: 'finance' });
  const adminActorMap = { id: admin._id, name: admin.name };
  const financeActorMap = { id: finance._id, name: finance.name };

  // ---- affiliates (backdated join dates)
  const affiliateDocsList = AFFILIATES_LIST.map((a) => {
    const joinedAt = daysAgo(a.joinedDaysAgo);
    return {
      _id: new mongoose.Types.ObjectId(),
      name: a.name,
      email: a.email,
      passwordHash: passwordHashMap.affiliate,
      role: 'affiliate',
      referralCode: a.code,
      payoutMethodMap: a.methodMap,
      createdAt: joinedAt,
      updatedAt: joinedAt,
    };
  });
  await User.insertMany(affiliateDocsList, { timestamps: false });

  // ---- clicks
  const clickDocsList = [];
  AFFILIATES_LIST.forEach((a, index) => {
    const affiliateDoc = affiliateDocsList[index];
    const maxDaysBack = Math.min(30, a.joinedDaysAgo);
    for (let i = 0; i < a.clicksCount; i++) {
      const at = daysAgo(randomInt(0, maxDaysBack));
      clickDocsList.push({
        affiliateId: affiliateDoc._id,
        referralCode: a.code,
        userAgent: 'seed',
        createdAt: at,
        updatedAt: at,
      });
    }
  });
  await Click.insertMany(clickDocsList, { timestamps: false });

  // ---- conversions + commissions (with full audit history) + payouts
  const conversionDocsList = [];
  const commissionDocsList = [];
  const payoutDocsList = [];
  let orderSequence = 1;

  AFFILIATES_LIST.forEach((a, index) => {
    const affiliateDoc = affiliateDocsList[index];
    const payoutCommissionsList = []; // commissions destined for this affiliate's payout batch

    for (const status of a.commissionStatusesList) {
      const [minBack, maxBack] = CREATED_DAYS_BACK_MAP[status];
      const createdAt = daysAgo(randomInt(minBack, Math.min(maxBack, a.joinedDaysAgo)));
      const orderAmountCents = pick(ORDER_AMOUNTS_LIST);
      const amountCents = Math.round((orderAmountCents * RATE_PERCENT) / 100);
      const externalOrderId = `ACME-SEED-${String(orderSequence++).padStart(4, '0')}`;

      const conversionId = new mongoose.Types.ObjectId();
      const commissionId = new mongoose.Types.ObjectId();
      const source = rand() < 0.7 ? 'storefront' : 'webhook';

      conversionDocsList.push({
        _id: conversionId,
        externalOrderId,
        affiliateId: affiliateDoc._id,
        referralCode: a.code,
        orderAmountCents,
        source,
        createdAt,
        updatedAt: createdAt,
      });

      const historyList = [
        { from: null, to: 'pending', byUserId: null, byName: 'system', note: `Conversion recorded via ${source}`, at: createdAt },
      ];
      let cursorAt = createdAt;
      if (['approved', 'processing', 'paid'].includes(status)) {
        cursorAt = new Date(cursorAt.getTime() + randomInt(6, 30) * HOUR_MS);
        historyList.push({ from: 'pending', to: 'approved', byUserId: admin._id, byName: admin.name, note: null, at: cursorAt });
      }
      if (status === 'rejected') {
        cursorAt = new Date(cursorAt.getTime() + randomInt(6, 30) * HOUR_MS);
        historyList.push({ from: 'pending', to: 'rejected', byUserId: admin._id, byName: admin.name, note: pick(REJECTION_NOTES_LIST), at: cursorAt });
      }
      // processing/paid entries are appended below once the payout reference exists

      commissionDocsList.push({
        _id: commissionId,
        affiliateId: affiliateDoc._id,
        conversionId,
        externalOrderId,
        orderAmountCents,
        ratePercent: RATE_PERCENT,
        amountCents,
        status,
        payoutId: null,
        statusHistoryList: historyList,
        createdAt,
        updatedAt: cursorAt,
      });

      if (status === 'processing' || status === 'paid') {
        payoutCommissionsList.push(commissionDocsList[commissionDocsList.length - 1]);
      }
    }

    if (payoutCommissionsList.length > 0) {
      const batchStatus = payoutCommissionsList[0].status === 'paid' ? 'paid' : 'pending';
      const payoutId = new mongoose.Types.ObjectId();
      const reference = `PO-SEED-${String(payoutDocsList.length + 1).padStart(3, '0')}`;
      const batchCreatedAt = new Date(
        Math.max(...payoutCommissionsList.map((c) => c.updatedAt.getTime())) + randomInt(12, 36) * HOUR_MS
      );
      const paidAt = batchStatus === 'paid' ? new Date(batchCreatedAt.getTime() + randomInt(24, 72) * HOUR_MS) : null;

      for (const commissionDoc of payoutCommissionsList) {
        commissionDoc.payoutId = payoutId;
        commissionDoc.statusHistoryList.push({
          from: 'approved', to: 'processing', byUserId: finance._id, byName: finance.name,
          note: `Added to payout ${reference}`, at: batchCreatedAt,
        });
        if (batchStatus === 'paid') {
          commissionDoc.statusHistoryList.push({
            from: 'processing', to: 'paid', byUserId: finance._id, byName: finance.name,
            note: `Paid via payout ${reference}`, at: paidAt,
          });
        }
        commissionDoc.updatedAt = paidAt || batchCreatedAt;
      }

      payoutDocsList.push({
        _id: payoutId,
        reference,
        affiliateId: affiliateDoc._id,
        commissionIds: payoutCommissionsList.map((c) => c._id),
        totalAmountCents: payoutCommissionsList.reduce((sum, c) => sum + c.amountCents, 0),
        payoutMethodMap: a.methodMap,
        status: batchStatus,
        paidAt,
        paymentNote: batchStatus === 'paid' ? 'Seed demo payment' : null,
        createdAt: batchCreatedAt,
        updatedAt: paidAt || batchCreatedAt,
      });
    }
  });

  await Conversion.insertMany(conversionDocsList, { timestamps: false });
  await Commission.insertMany(commissionDocsList, { timestamps: false });
  await Payout.insertMany(payoutDocsList, { timestamps: false });

  const totalCommissionCents = commissionDocsList.reduce((sum, c) => sum + c.amountCents, 0);
  console.log('');
  console.log('Seed complete ✅');
  console.log(`  affiliates: ${AFFILIATES_LIST.length} | clicks: ${clickDocsList.length} | conversions: ${conversionDocsList.length}`);
  console.log(`  commissions: ${commissionDocsList.length} ($${(totalCommissionCents / 100).toFixed(2)} total) | payouts: ${payoutDocsList.length}`);
  console.log('');
  console.log('Demo credentials (password in parentheses):');
  console.log('  Dashboard admin    admin@amplify.dev   (Admin123!)   — affiliate team');
  console.log('  Dashboard finance  finance@amplify.dev (Finance123!) — finance team');
  console.log('  Mobile affiliate   priya@example.com   (Affiliate123!)');
  console.log('  Mobile affiliate   leo@example.com     (Affiliate123!) — brand new, empty state');
  console.log('  (all seeded affiliates use Affiliate123!)');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
