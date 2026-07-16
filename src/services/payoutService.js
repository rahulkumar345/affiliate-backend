import mongoose from 'mongoose';
import { Commission } from '../models/Commission.js';
import { Payout } from '../models/Payout.js';
import { User } from '../models/User.js';
import { ProgramConfig } from '../models/ProgramConfig.js';
import { badRequest, notFound } from '../middleware/errors.js';
import { historyEntryMap } from './commissionService.js';

function generateReference() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PO-${stamp}-${rand}`;
}

// Affiliates whose approved (unpaid) balance clears the minimum payout threshold
export async function eligibleBalancesList() {
  const config = await ProgramConfig.get();
  const groupedList = await Commission.aggregate([
    { $match: { status: 'approved' } },
    {
      $group: {
        _id: '$affiliateId',
        totalAmountCents: { $sum: '$amountCents' },
        commissionCount: { $sum: 1 },
      },
    },
    { $sort: { totalAmountCents: -1 } },
  ]);

  const affiliateIds = groupedList.map((row) => row._id);
  const affiliatesList = await User.find({ _id: { $in: affiliateIds } });
  const affiliatesByIdMap = new Map(affiliatesList.map((u) => [String(u._id), u]));

  return groupedList.map((row) => {
    const affiliate = affiliatesByIdMap.get(String(row._id));
    return {
      affiliateId: row._id,
      affiliateName: affiliate ? affiliate.name : 'Unknown',
      affiliateEmail: affiliate ? affiliate.email : null,
      hasPayoutMethod: Boolean(affiliate && affiliate.payoutMethodMap),
      totalAmountCents: row.totalAmountCents,
      commissionCount: row.commissionCount,
      meetsMinimum: row.totalAmountCents >= config.minPayoutCents,
      minPayoutCents: config.minPayoutCents,
    };
  });
}

// Sweeps ALL approved commissions for one affiliate into a new payout batch
// and moves them to 'processing'.
export async function createPayoutBatch(affiliateId, actorMap) {
  const affiliate = await User.findOne({ _id: affiliateId, role: 'affiliate' });
  if (!affiliate) throw notFound('Affiliate not found');

  const commissionsList = await Commission.find({ affiliateId, status: 'approved' });
  if (commissionsList.length === 0) throw badRequest('No approved commissions to pay out for this affiliate');

  const config = await ProgramConfig.get();
  const totalAmountCents = commissionsList.reduce((sum, c) => sum + c.amountCents, 0);
  if (totalAmountCents < config.minPayoutCents) {
    throw badRequest(`Balance is below the minimum payout threshold (${config.minPayoutCents} cents)`);
  }

  const commissionIds = commissionsList.map((c) => c._id);
  const payout = await Payout.create({
    reference: generateReference(),
    affiliateId,
    commissionIds,
    totalAmountCents,
    payoutMethodMap: affiliate.payoutMethodMap || null,
    status: 'pending',
  });

  await Commission.updateMany(
    { _id: { $in: commissionIds }, status: 'approved' },
    {
      $set: { status: 'processing', payoutId: payout._id },
      $push: { statusHistoryList: historyEntryMap('approved', 'processing', actorMap, `Added to payout ${payout.reference}`) },
    }
  );

  return payout;
}

// Marks a payout batch as paid and finalizes its commissions
export async function markPayoutPaid(payoutId, actorMap, paymentNote = null) {
  if (!mongoose.isValidObjectId(payoutId)) throw notFound('Payout not found');
  const payout = await Payout.findById(payoutId);
  if (!payout) throw notFound('Payout not found');
  if (payout.status === 'paid') throw badRequest('Payout is already marked as paid');

  payout.status = 'paid';
  payout.paidAt = new Date();
  payout.paymentNote = paymentNote || null;
  await payout.save();

  await Commission.updateMany(
    { _id: { $in: payout.commissionIds }, status: 'processing' },
    {
      $set: { status: 'paid' },
      $push: { statusHistoryList: historyEntryMap('processing', 'paid', actorMap, `Paid via payout ${payout.reference}`) },
    }
  );

  return payout;
}
