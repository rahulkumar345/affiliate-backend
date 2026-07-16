import { Router } from 'express';
import { asyncHandler, badRequest } from '../middleware/errors.js';
import { User } from '../models/User.js';
import { Click } from '../models/Click.js';
import { recordConversion } from '../services/conversionService.js';
import { storePageHtml, PRODUCTS_MAP } from '../views/storePage.js';

const router = Router();

const REF_COOKIE = 'amplify_ref';
const REF_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30-day attribution window

/**
 * GET /r/:code — the affiliate share link.
 * Logs a click, drops an attribution cookie, and lands on the demo store.
 * Unknown codes still reach the store (a broken share link would be a terrible
 * first impression for a potential customer) — they just aren't attributed.
 */
router.get(
  '/r/:code',
  asyncHandler(async (req, res) => {
    const code = String(req.params.code || '').toUpperCase();
    const affiliate = await User.findOne({ referralCode: code, role: 'affiliate' });

    if (affiliate) {
      await Click.create({
        affiliateId: affiliate._id,
        referralCode: code,
        userAgent: req.headers['user-agent'] || null,
      });
      res.cookie(REF_COOKIE, code, { maxAge: REF_COOKIE_MAX_AGE_MS });
      return res.redirect(`/store?ref=${encodeURIComponent(code)}`);
    }
    res.redirect('/store');
  })
);

// GET /store — demo merchant storefront
router.get('/store', (req, res) => {
  const refCode = req.query.ref || req.cookies[REF_COOKIE] || null;
  res.type('html').send(storePageHtml(refCode));
});

/**
 * POST /api/store/checkout — the demo store's order endpoint.
 * Generates an order id server-side and records the conversion through the
 * exact same service the external webhook uses (same idempotency, same
 * commission math). Orders without a valid referral still succeed — they
 * just don't create a commission, like real un-attributed traffic.
 */
router.post(
  '/api/store/checkout',
  asyncHandler(async (req, res) => {
    const { productId, refCode } = req.body || {};
    const product = PRODUCTS_MAP[productId];
    if (!product) throw badRequest('Unknown product');

    const orderId = `ACME-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    let commissionRecorded = false;
    if (refCode) {
      const resultMap = await recordConversion({
        externalOrderId: orderId,
        referralCode: String(refCode).toUpperCase(),
        orderAmountCents: product.priceCents,
        source: 'storefront',
      });
      commissionRecorded = resultMap.status === 'recorded';
    }

    res.status(201).json({ orderId, commissionRecorded });
  })
);

export default router;
