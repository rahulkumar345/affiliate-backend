import mongoose from 'mongoose';

const conversionSchema = new mongoose.Schema(
  {
    // The order id in the merchant's system. Unique index = idempotent ingestion:
    // the same order can never create two conversions (and thus two commissions).
    externalOrderId: { type: String, required: true, unique: true },
    affiliateId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referralCode: { type: String, required: true },
    orderAmountCents: { type: Number, required: true, min: 1 },
    source: { type: String, enum: ['storefront', 'webhook'], default: 'webhook' },
  },
  { timestamps: true }
);

export const Conversion = mongoose.model('Conversion', conversionSchema);
