const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userTelegramId: { type: Number, required: true, index: true },
  type: { type: String, enum: ['deposit', 'purchase', 'refund', 'admin_adjustment'], required: true },
  amount: { type: Number, required: true },
  balanceBefore: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  referenceType: { type: String, enum: ['payment', 'subscription', 'gift', 'manual', 'refund'], default: 'manual' },
  referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
  description: { type: String, default: '' },
  createdBy: { type: Number, default: null }
}, { timestamps: true });

module.exports = mongoose.model('WalletTransaction', schema);
