const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true, index: true },
  title: { type: String, default: 'ادمین' },
  permissions: {
    prompts: { type: Boolean, default: false },
    lessons: { type: Boolean, default: false },
    payments: { type: Boolean, default: false },
    users: { type: Boolean, default: false },
    discounts: { type: Boolean, default: false },
    broadcast: { type: Boolean, default: false },
    support: { type: Boolean, default: false },
    channelPosts: { type: Boolean, default: false },
    requests: { type: Boolean, default: false },
    results: { type: Boolean, default: false }
  },
  isActive: { type: Boolean, default: true },
  createdBy: { type: Number, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Admin', schema);
