const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  chatId: { type: String, required: true, unique: true, trim: true },
  inviteLink: { type: String, required: true, trim: true },
  isActive: { type: Boolean, default: true, index: true },
  sortOrder: { type: Number, default: 0 },
  createdBy: { type: Number, required: true }
}, { timestamps: true });
module.exports = mongoose.model('RequiredChannel', schema);
