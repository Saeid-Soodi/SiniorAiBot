const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  type: { type: String, enum: ['percent', 'fixed'], default: 'percent' },
  value: { type: Number, required: true },
  startsAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  maxUses: { type: Number, default: 100 },
  maxUsesPerUser: { type: Number, default: 1 },
  usedCount: { type: Number, default: 0 },
  usedBy: [Number],
  isActive: { type: Boolean, default: true },
  stackable: { type: Boolean, default: false },
  createdBy: { type: Number, required: true }
}, { timestamps: true });

module.exports = mongoose.model('DiscountCode', schema);
