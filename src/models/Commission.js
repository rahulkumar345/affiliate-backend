import mongoose from 'mongoose';

export const COMMISSION_STATUSES_LIST = ['pending', 'approved', 'rejected', 'processing', 'paid'];

// Every entry is an immutable audit record of one state change
const statusHistorySchema = new mongoose.Schema(
  {
    from: { type: String, default: null },
    to: { type: String, required: true },
    byUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    byName: { type: String, default: null },
    note: { type: String, default: null },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const commissionSchema = new mongoose.Schema(
  {
    affiliateId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    conversionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversion', required: true },
    // Denormalized from the conversion for cheap display in lists
    externalOrderId: { type: String, required: true },
    orderAmountCents: { type: Number, required: true },
    ratePercent: { type: Number, required: true },
    amountCents: { type: Number, required: true, min: 0 },
    status: { type: String, enum: COMMISSION_STATUSES_LIST, default: 'pending', index: true },
    // Set when the commission is swept into a payout batch
    payoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payout', default: null },
    statusHistoryList: { type: [statusHistorySchema], default: [] },
  },
  { timestamps: true }
);

export const Commission = mongoose.model('Commission', commissionSchema);
