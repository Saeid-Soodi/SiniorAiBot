const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userTelegramId: { type: Number, required: true, index: true },
  promptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prompt', required: true, index: true },
  fileId: { type: String, required: true },
  fileType: { type: String, enum: ['photo', 'video', 'document'], default: 'photo' },
  caption: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedBy: { type: Number, default: null },
  reviewedAt: { type: Date, default: null },
  adminScore: { type: Number, min: 1, max: 10, default: null, index: true }
}, { timestamps: true });

module.exports = mongoose.model('PromptResult', schema);
