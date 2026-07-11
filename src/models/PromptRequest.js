const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userTelegramId: { type: Number, required: true, index: true },
  text: { type: String, required: true, trim: true },
  status: { type: String, enum: ['pending', 'in_progress', 'done', 'rejected'], default: 'pending', index: true },
  adminNote: { type: String, default: '' },
  deliveredPromptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prompt', default: null }
}, { timestamps: true });

module.exports = mongoose.model('PromptRequest', schema);
