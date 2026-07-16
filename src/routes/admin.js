import { Router } from 'express';
import mongoose from 'mongoose';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, badRequest, notFound } from '../middleware/errors.js';
import { User } from '../models/User.js';
import { Click } from '../models/Click.js';
import { Conversion } from '../models/Conversion.js';
import { Commission } from '../models/Commission.js';
import { Payout } from '../models/Payout.js';
import { ProgramConfig } from '../models/ProgramConfig.js';
import { applyTransition } from '../services/commissionService.js';
import { eligibleBalancesList, createPayoutBatch, markPayoutPaid } from '../services/payoutService.js';
import { toCsv, formatUsd } from '../utils/csv.js';

const router = Router();

// Both back-office roles can see everything; write access is split below:
// commission approval = affiliate team (admin), payouts = finance (admin can cover both).
router.use(requireAuth, requireRole('admin', 'finance'));

// ---------------------------------------------------------------- metrics

router.get(
  '/metrics',
  asyncHandler(async (req, res) => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [affiliatesTotal, affiliatesThisWeek, clicksTotal, conversionsTotal, commissionRowsList, payoutRowsList] =
      await Promise.all([
        User.countDocuments({ role: 'affiliate' }),
        User.countDocuments({ role: 'affiliate', createdAt: { $gte: weekAgo } }),
        Click.countDocuments({}),
        Conversion.countDocuments({}),
        Commission.aggregate([
          { $group: { _id: '$status', totalCents: { $sum: '$amountCents' }, count: { $sum: 1 } } },
        ]),
        Payout.aggregate([
          { $group: { _id: '$status', totalCents: { $sum: '$totalAmountCents' }, count: { $sum: 1 } } },
        ]),
      ]);

    const commissionTotalsMap = {};
    for (const status of ['pending', 'approved', 'processing', 'paid', 'rejected']) {
      const row = commissionRowsList.find((r) => r._id === status);
      commissionTotalsMap[status] = { totalCents: row ? row.totalCents : 0, count: row ? row.count : 0 };
    }

    const pendingPayoutRow = payoutRowsList.find((r) => r._id === 'pending');
    res.json({
      affiliatesTotal,
      affiliatesThisWeek,
      clicksTotal,
      conversionsTotal,
      conversionRatePercent: clicksTotal > 0 ? Math.round((conversionsTotal / clicksTotal) * 1000) / 10 : 0,
      commissionTotalsMap,
      payoutsPendingCount: pendingPayoutRow ? pendingPayoutRow.count : 0,
      payoutsPendingCents: pendingPayoutRow ? pendingPayoutRow.totalCents : 0,
    });
  })
);

// ---------------------------------------------------------------- affiliates

router.get(
  '/affiliates',
  asyncHandler(async (req, res) => {
    const [affiliatesList, clickRowsList, conversionRowsList, earningRowsList] = await Promise.all([
      User.find({ role: 'affiliate' }).sort({ createdAt: -1 }),
      Click.aggregate([{ $group: { _id: '$affiliateId', count: { $sum: 1 } } }]),
      Conversion.aggregate([{ $group: { _id: '$affiliateId', count: { $sum: 1 } } }]),
      Commission.aggregate([
        { $group: { _id: { affiliateId: '$affiliateId', status: '$status' }, totalCents: { $sum: '$amountCents' } } },
      ]),
    ]);

    const clicksByAffiliateMap = Object.fromEntries(clickRowsList.map((r) => [String(r._id), r.count]));
    const conversionsByAffiliateMap = Object.fromEntries(conversionRowsList.map((r) => [String(r._id), r.count]));
    const earningsByAffiliateMap = {};
    for (const row of earningRowsList) {
      const key = String(row._id.affiliateId);
      if (!earningsByAffiliateMap[key]) earningsByAffiliateMap[key] = {};
      earningsByAffiliateMap[key][row._id.status] = row.totalCents;
    }

    res.json({
      affiliatesList: affiliatesList.map((a) => {
        const key = String(a._id);
        const earningsMap = earningsByAffiliateMap[key] || {};
        return {
          id: a._id,
          name: a.name,
          email: a.email,
          referralCode: a.referralCode,
          payoutMethodSet: Boolean(a.payoutMethodMap),
          clicksCount: clicksByAffiliateMap[key] || 0,
          conversionsCount: conversionsByAffiliateMap[key] || 0,
          pendingCents: earningsMap.pending || 0,
          approvedCents: earningsMap.approved || 0,
          processingCents: earningsMap.processing || 0,
          paidCents: earningsMap.paid || 0,
          createdAt: a.createdAt,
        };
      }),
    });
  })
);

// ---------------------------------------------------------------- commissions

router.get(
  '/commissions',
  asyncHandler(async (req, res) => {
    const filterMap = {};
    if (req.query.status) filterMap.status = req.query.status;
    if (req.query.affiliateId && mongoose.isValidObjectId(req.query.affiliateId)) {
      filterMap.affiliateId = req.query.affiliateId;
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);

    const commissionsList = await Commission.find(filterMap)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('affiliateId', 'name email');

    res.json({
      commissionsList: commissionsList.map((c) => ({
        id: c._id,
        affiliateId: c.affiliateId ? c.affiliateId._id : null,
        affiliateName: c.affiliateId ? c.affiliateId.name : 'Unknown',
        affiliateEmail: c.affiliateId ? c.affiliateId.email : null,
        externalOrderId: c.externalOrderId,
        orderAmountCents: c.orderAmountCents,
        ratePercent: c.ratePercent,
        amountCents: c.amountCents,
        status: c.status,
        payoutId: c.payoutId,
        statusHistoryList: c.statusHistoryList,
        createdAt: c.createdAt,
      })),
    });
  })
);

const ACTION_TO_STATUS_MAP = { approve: 'approved', reject: 'rejected' };

router.patch(
  '/commissions/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const toStatus = ACTION_TO_STATUS_MAP[req.body ? req.body.action : null];
    if (!toStatus) throw badRequest("action must be 'approve' or 'reject'");
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Commission not found');

    const commission = await Commission.findById(req.params.id);
    if (!commission) throw notFound('Commission not found');

    applyTransition(commission, toStatus, req.userMap, req.body.note || null);
    await commission.save();
    res.json({ id: commission._id, status: commission.status });
  })
);

// Bulk approve/reject. Each id is validated independently: invalid transitions
// are skipped and reported, never silently applied.
router.post(
  '/commissions/bulk',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { commissionIds, action, note } = req.body || {};
    const toStatus = ACTION_TO_STATUS_MAP[action];
    if (!toStatus) throw badRequest("action must be 'approve' or 'reject'");
    if (!Array.isArray(commissionIds) || commissionIds.length === 0) {
      throw badRequest('commissionIds must be a non-empty array');
    }

    let updatedCount = 0;
    const skippedList = [];
    for (const id of commissionIds) {
      const commission = mongoose.isValidObjectId(id) ? await Commission.findById(id) : null;
      if (!commission) {
        skippedList.push({ id, reason: 'not found' });
        continue;
      }
      try {
        applyTransition(commission, toStatus, req.userMap, note || null);
        await commission.save();
        updatedCount += 1;
      } catch (err) {
        skippedList.push({ id, reason: err.message });
      }
    }
    res.json({ updatedCount, skippedList });
  })
);

// ---------------------------------------------------------------- payouts

router.get(
  '/payouts/eligible',
  asyncHandler(async (req, res) => {
    res.json({ eligibleList: await eligibleBalancesList() });
  })
);

// The "payment run" file finance actually works from
router.get(
  '/payouts/export.csv',
  asyncHandler(async (req, res) => {
    const status = req.query.status || 'pending';
    const filterMap = status === 'all' ? {} : { status };
    const payoutsList = await Payout.find(filterMap).sort({ createdAt: -1 }).populate('affiliateId', 'name email');

    const methodSummary = (methodMap) => {
      if (!methodMap) return 'NOT SET';
      if (methodMap.method === 'upi') return `UPI: ${methodMap.upiId}`;
      if (methodMap.method === 'bank') return `Bank: ${methodMap.accountName} / ${methodMap.accountNumber} / ${methodMap.ifsc}`;
      if (methodMap.method === 'paypal') return `PayPal: ${methodMap.paypalEmail}`;
      return 'UNKNOWN';
    };

    const headersList = ['Reference', 'Affiliate', 'Email', 'Payment method', 'Amount (USD)', 'Commissions', 'Status', 'Created', 'Paid at'];
    const rowsList = payoutsList.map((p) => [
      p.reference,
      p.affiliateId ? p.affiliateId.name : 'Unknown',
      p.affiliateId ? p.affiliateId.email : '',
      methodSummary(p.payoutMethodMap),
      formatUsd(p.totalAmountCents).slice(1), // numeric column, no $ sign
      p.commissionIds.length,
      p.status,
      p.createdAt.toISOString(),
      p.paidAt ? p.paidAt.toISOString() : '',
    ]);

    res
      .type('text/csv')
      .set('Content-Disposition', `attachment; filename="payouts-${status}.csv"`)
      .send(toCsv(headersList, rowsList));
  })
);

router.get(
  '/payouts',
  asyncHandler(async (req, res) => {
    const filterMap = req.query.status ? { status: req.query.status } : {};
    const payoutsList = await Payout.find(filterMap).sort({ createdAt: -1 }).limit(200).populate('affiliateId', 'name email');
    res.json({
      payoutsList: payoutsList.map((p) => ({
        id: p._id,
        reference: p.reference,
        affiliateId: p.affiliateId ? p.affiliateId._id : null,
        affiliateName: p.affiliateId ? p.affiliateId.name : 'Unknown',
        affiliateEmail: p.affiliateId ? p.affiliateId.email : null,
        totalAmountCents: p.totalAmountCents,
        commissionCount: p.commissionIds.length,
        payoutMethodMap: p.payoutMethodMap || null,
        status: p.status,
        paymentNote: p.paymentNote,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
    });
  })
);

router.post(
  '/payouts',
  asyncHandler(async (req, res) => {
    const { affiliateId } = req.body || {};
    if (!affiliateId || !mongoose.isValidObjectId(affiliateId)) throw badRequest('affiliateId is required');
    const payout = await createPayoutBatch(affiliateId, req.userMap);
    res.status(201).json({ id: payout._id, reference: payout.reference, totalAmountCents: payout.totalAmountCents });
  })
);

router.patch(
  '/payouts/:id/mark-paid',
  asyncHandler(async (req, res) => {
    const payout = await markPayoutPaid(req.params.id, req.userMap, req.body ? req.body.paymentNote : null);
    res.json({ id: payout._id, reference: payout.reference, status: payout.status, paidAt: payout.paidAt });
  })
);

// ---------------------------------------------------------------- program config

router.get(
  '/config',
  asyncHandler(async (req, res) => {
    const config = await ProgramConfig.get();
    res.json({ commissionRatePercent: config.commissionRatePercent, minPayoutCents: config.minPayoutCents });
  })
);

router.put(
  '/config',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { commissionRatePercent, minPayoutCents } = req.body || {};
    if (typeof commissionRatePercent !== 'number' || commissionRatePercent < 0 || commissionRatePercent > 100) {
      throw badRequest('commissionRatePercent must be a number between 0 and 100');
    }
    if (!Number.isInteger(minPayoutCents) || minPayoutCents < 0) {
      throw badRequest('minPayoutCents must be a non-negative integer');
    }
    const config = await ProgramConfig.get();
    config.commissionRatePercent = commissionRatePercent;
    config.minPayoutCents = minPayoutCents;
    await config.save();
    res.json({ commissionRatePercent: config.commissionRatePercent, minPayoutCents: config.minPayoutCents });
  })
);

export default router;
