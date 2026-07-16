import mongoose from 'mongoose';

const clickSchema = new mongoose.Schema(
  {
    affiliateId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referralCode: { type: String, required: true },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

export const Click = mongoose.model('Click', clickSchema);
