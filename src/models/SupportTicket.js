const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  userTelegramId: { type: Number, required: true, index: true },
  text: { type: String, default: '' },
  fileId: { type: String, default: null },
  fileType: { type: String, enum: ['none', 'photo', 'document', 'video'], default: 'none' },
  status: { type: String, enum: ['open', 'answered', 'closed'], default: 'open', index: true },
  answeredBy: { type: Number, default: null },
  answeredAt: { type: Date, default: null },
  answerText: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('SupportTicket', schema);
