const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userTelegramId: { type: Number, required: true, index: true },
  text: { type: String, required: true, trim: true },
  imageFileId: { type: String, default: null },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  adminNote: { type: String, default: '' },
  reviewedBy: { type: Number, default: null },
  reviewedAt: { type: Date, default: null },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: Number, default: null }
}, { timestamps: true });

module.exports = mongoose.model('PromptRequest', schema);
