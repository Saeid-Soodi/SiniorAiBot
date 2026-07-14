const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  actorTelegramId: { type: Number, required: true, index: true },
  action: { type: String, required: true },
  entityType: { type: String, default: '' },
  entityId: { type: String, default: '' },
  details: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });
module.exports = mongoose.model('AuditLog', schema);
