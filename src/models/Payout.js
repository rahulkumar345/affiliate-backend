import mongoose from 'mongoose';

const payoutSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true },
    affiliateId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    commissionIds: { type: [mongoose.Schema.Types.ObjectId], ref: 'Commission', required: true },
    totalAmountCents: { type: Number, required: true, min: 1 },
    // Snapshot of the affiliate's payout method at batch-creation time, so the
    // batch stays payable exactly as exported even if the affiliate edits details later
    payoutMethodMap: { type: Object, default: null },
    status: { type: String, enum: ['pending', 'paid'], default: 'pending', index: true },
    paidAt: { type: Date, default: null },
    paymentNote: { type: String, default: null },
  },
  { timestamps: true }
);

export const Payout = mongoose.model('Payout', payoutSchema);
