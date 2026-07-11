const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userTelegramId: { type: Number, required: true, index: true },
  receiptFileId: { type: String, required: true },
  originalPrice: { type: Number, required: true },
  discountAmount: { type: Number, default: 0 },
  finalPrice: { type: Number, required: true },
  discountSource: { type: String, default: 'none' },
  discountCode: { type: String, default: null },
  sourcePromptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prompt', default: null },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  paymentCode: { type: String, unique: true, sparse: true, index: true },
  reviewedBy: { type: Number, default: null },
  reviewedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Payment', schema);
