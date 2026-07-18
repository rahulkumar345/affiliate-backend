import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['affiliate', 'admin', 'finance'], default: 'affiliate' },
    // Only affiliates get a referral code; null for admin/finance users
    referralCode: { type: String, default: null },
    // Per-affiliate commission rate override. null = fall back to the
    // program-wide ProgramConfig rate; a number (0–100) overrides it.
    commissionRatePercent: { type: Number, default: null, min: 0, max: 100 },
    // { method: 'upi'|'bank'|'paypal', ...method-specific fields }; null until the affiliate adds one
    payoutMethodMap: { type: Object, default: null },
  },
  { timestamps: true }
);

// Partial (not sparse) index: sparse indexes still index explicit nulls, and
// admin/finance users store referralCode: null. Only string codes are indexed.
userSchema.index(
  { referralCode: 1 },
  { unique: true, partialFilterExpression: { referralCode: { $type: 'string' } } }
);

export function publicUserMap(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    referralCode: user.referralCode,
    commissionRatePercent: user.commissionRatePercent ?? null,
    payoutMethodMap: user.payoutMethodMap || null,
    createdAt: user.createdAt,
  };
}

export const User = mongoose.model('User', userSchema);
