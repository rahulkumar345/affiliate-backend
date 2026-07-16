import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, badRequest, notFound } from '../middleware/errors.js';
import { User, publicUserMap } from '../models/User.js';
import { Click } from '../models/Click.js';
import { Conversion } from '../models/Conversion.js';
import { Commission } from '../models/Commission.js';
import { Payout } from '../models/Payout.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.userMap.id);
    if (!user) throw notFound('User not found');

    const [clicksCount, conversionsCount, sumRowsList] = await Promise.all([
      Click.countDocuments({ affiliateId: user._id }),
      Conversion.countDocuments({ affiliateId: user._id }),
      Commission.aggregate([
        { $match: { affiliateId: user._id } },
        { $group: { _id: '$status', totalCents: { $sum: '$amountCents' } } },
      ]),
    ]);

    const earningsMap = { pendingCents: 0, approvedCents: 0, processingCents: 0, paidCents: 0, rejectedCents: 0 };
    for (const row of sumRowsList) earningsMap[`${row._id}Cents`] = row.totalCents;
    // Lifetime = everything except rejected
    earningsMap.lifetimeCents =
      earningsMap.pendingCents + earningsMap.approvedCents + earningsMap.processingCents + earningsMap.paidCents;

    const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
    res.json({
      userMap: publicUserMap(user),
      referralCode: user.referralCode,
      shareUrl: user.referralCode ? `${baseUrl}/r/${user.referralCode}` : null,
      clicksCount,
      conversionsCount,
      earningsMap,
    });
  })
);

router.get(
  '/commissions',
  asyncHandler(async (req, res) => {
    const commissionsList = await Commission.find({ affiliateId: req.userMap.id })
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({
      commissionsList: commissionsList.map((c) => ({
        id: c._id,
        externalOrderId: c.externalOrderId,
        orderAmountCents: c.orderAmountCents,
        ratePercent: c.ratePercent,
        amountCents: c.amountCents,
        status: c.status,
        createdAt: c.createdAt,
      })),
    });
  })
);

router.get(
  '/payouts',
  asyncHandler(async (req, res) => {
    const payoutsList = await Payout.find({ affiliateId: req.userMap.id }).sort({ createdAt: -1 }).limit(100);
    res.json({
      payoutsList: payoutsList.map((p) => ({
        id: p._id,
        reference: p.reference,
        totalAmountCents: p.totalAmountCents,
        commissionCount: p.commissionIds.length,
        status: p.status,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
      })),
    });
  })
);

const PAYOUT_METHOD_FIELDS_MAP = {
  upi: ['upiId'],
  bank: ['accountName', 'accountNumber', 'ifsc'],
  paypal: ['paypalEmail'],
};

router.put(
  '/payout-method',
  asyncHandler(async (req, res) => {
    const { method } = req.body || {};
    const requiredFieldsList = PAYOUT_METHOD_FIELDS_MAP[method];
    if (!requiredFieldsList) throw badRequest(`method must be one of: ${Object.keys(PAYOUT_METHOD_FIELDS_MAP).join(', ')}`);

    const payoutMethodMap = { method };
    for (const field of requiredFieldsList) {
      const value = String(req.body[field] || '').trim();
      if (!value) throw badRequest(`${field} is required for method '${method}'`);
      payoutMethodMap[field] = value;
    }

    const user = await User.findByIdAndUpdate(req.userMap.id, { payoutMethodMap }, { new: true });
    res.json({ userMap: publicUserMap(user) });
  })
);

export default router;
