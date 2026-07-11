const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userTelegramId: { type: Number, required: true, index: true },
  promptId: { type: mongoose.Schema.Types.ObjectId, ref: 'Prompt', required: true, index: true },
  rating: { type: Number, min: 1, max: 5, required: true }
}, { timestamps: true });

schema.index({ userTelegramId: 1, promptId: 1 }, { unique: true });
module.exports = mongoose.model('PromptRating', schema);
