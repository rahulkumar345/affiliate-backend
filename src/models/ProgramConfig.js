import mongoose from 'mongoose';

const programConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    commissionRatePercent: { type: Number, default: 10, min: 0, max: 100 },
    minPayoutCents: { type: Number, default: 1000, min: 0 },
  },
  { timestamps: true }
);

// Singleton accessor — creates the default config on first use
programConfigSchema.statics.get = async function () {
  let config = await this.findOne({ key: 'global' });
  if (!config) config = await this.create({ key: 'global' });
  return config;
};

export const ProgramConfig = mongoose.model('ProgramConfig', programConfigSchema);
