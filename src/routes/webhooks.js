import { Router } from 'express';
import { asyncHandler, badRequest } from '../middleware/errors.js';
import { recordConversion } from '../services/conversionService.js';

const router = Router();

/**
 * POST /api/webhooks/conversion
 * The contract a real merchant/store would call on every completed order.
 *
 * Body: { externalOrderId, referralCode, orderAmountCents }
 * Idempotent: replaying the same externalOrderId returns 200 'duplicate'
 * and never creates a second commission.
 *
 * If WEBHOOK_SECRET is set in the environment, the request must include
 * it in the `x-webhook-secret` header.
 */
router.post(
  '/conversion',
  asyncHandler(async (req, res) => {
    const configuredSecret = process.env.WEBHOOK_SECRET || null;
    if (configuredSecret && req.headers['x-webhook-secret'] !== configuredSecret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const { externalOrderId, referralCode, orderAmountCents } = req.body || {};
    if (!externalOrderId || !referralCode || !Number.isInteger(orderAmountCents) || orderAmountCents <= 0) {
      throw badRequest('externalOrderId, referralCode and a positive integer orderAmountCents are required');
    }

    const resultMap = await recordConversion({
      externalOrderId: String(externalOrderId),
      referralCode: String(referralCode).toUpperCase(),
      orderAmountCents,
      source: 'webhook',
    });

    if (resultMap.status === 'unknown_referral') {
      return res.status(422).json({ status: 'unknown_referral', error: 'No affiliate matches this referral code' });
    }
    if (resultMap.status === 'duplicate') {
      return res.status(200).json({ status: 'duplicate', message: 'Order already recorded — no duplicate commission created' });
    }
    res.status(201).json({
      status: 'recorded',
      commissionId: resultMap.commission._id,
      commissionAmountCents: resultMap.commission.amountCents,
    });
  })
);

export default router;
