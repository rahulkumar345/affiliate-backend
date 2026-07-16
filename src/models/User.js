import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['affiliate', 'admin', 'finance'], default: 'affiliate' },
    // Only affiliates get a referral code; null for admin/finance users
    referralCode: { type: String, default: null },
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
    payoutMethodMap: user.payoutMethodMap || null,
    createdAt: user.createdAt,
  };
}

export const User = mongoose.model('User', userSchema);
