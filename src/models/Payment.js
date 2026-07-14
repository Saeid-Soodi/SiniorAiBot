const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userTelegramId: { type: Number, required: true, index: true },
  type: { type: String, enum: ['vip_purchase', 'vip_renewal', 'gift_purchase', 'wallet_topup'], default: 'vip_purchase', index: true },
  targetTelegramId: { type: Number, default: null },
  receiptFileId: { type: String, required: true },
  originalPrice: { type: Number, required: true },
  discountAmount: { type: Number, default: 0 },
  finalPrice: { type: Number, required: true },
  requestedAmount: { type: Number, default: null },
  discountSource: { type: String, default: 'none' },
  discountCode: { type: String, default: null },
  sourcePromptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prompt', default: null },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  paymentCode: { type: String, unique: true, sparse: true, index: true },
  reviewedBy: { type: Number, default: null },
  reviewedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: Number, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Payment', schema);
