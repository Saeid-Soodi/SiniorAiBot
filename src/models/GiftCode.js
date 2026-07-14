const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  buyerTelegramId: { type: Number, required: true, index: true },
  paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
  vipDays: { type: Number, default: 30 },
  status: { type: String, enum: ['active', 'used', 'revoked'], default: 'active', index: true },
  usedBy: { type: Number, default: null },
  usedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('GiftCode', schema);
