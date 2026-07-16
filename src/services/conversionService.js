import { User } from '../models/User.js';
import { Conversion } from '../models/Conversion.js';
import { Commission } from '../models/Commission.js';
import { ProgramConfig } from '../models/ProgramConfig.js';
import { historyEntryMap } from './commissionService.js';

/**
 * Records a conversion and creates its pending commission.
 * Shared by the webhook endpoint and the demo storefront checkout,
 * so both paths get identical idempotency + commission logic.
 *
 * Returns:
 *  { status: 'recorded', conversion, commission }
 *  { status: 'duplicate' }            — externalOrderId already seen (idempotent replay)
 *  { status: 'unknown_referral' }     — referral code doesn't match an affiliate
 */
export async function recordConversion({ externalOrderId, referralCode, orderAmountCents, source = 'webhook' }) {
  const affiliate = await User.findOne({ referralCode, role: 'affiliate' });
  if (!affiliate) return { status: 'unknown_referral' };

  let conversion;
  try {
    conversion = await Conversion.create({
      externalOrderId,
      affiliateId: affiliate._id,
      referralCode,
      orderAmountCents,
      source,
    });
  } catch (err) {
    // E11000 = duplicate externalOrderId — the order was already ingested
    if (err.code === 11000) return { status: 'duplicate' };
    throw err;
  }

  const config = await ProgramConfig.get();
  const amountCents = Math.round((orderAmountCents * config.commissionRatePercent) / 100);

  const commission = await Commission.create({
    affiliateId: affiliate._id,
    conversionId: conversion._id,
    externalOrderId,
    orderAmountCents,
    ratePercent: config.commissionRatePercent,
    amountCents,
    status: 'pending',
    statusHistoryList: [historyEntryMap(null, 'pending', null, `Conversion recorded via ${source}`)],
  });

  return { status: 'recorded', conversion, commission };
}
