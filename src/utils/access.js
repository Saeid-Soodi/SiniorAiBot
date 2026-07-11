const env = require('../config/env');

function isOwner(id) {
  return Number(id) === Number(env.ownerId);
}

function isAdmin(id) {
  const numericId = Number(id);
  return isOwner(numericId) || env.adminIds.includes(numericId);
}

function isManagement(id) {
  return isAdmin(id);
}

module.exports = { isOwner, isAdmin, isManagement };
