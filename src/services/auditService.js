const AuditLog = require('../models/AuditLog');
async function audit(actorTelegramId, action, entityType = '', entityId = '', details = {}) {
  return AuditLog.create({ actorTelegramId, action, entityType, entityId: String(entityId || ''), details });
}
module.exports = { audit };
