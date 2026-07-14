const env = require('../config/env');
function isOwner(id) { return Number(id) === Number(env.ownerId); }
function isAdmin(id) { return isOwner(id) || env.adminIds.includes(Number(id)); }
function isManagement(id) { return isAdmin(id); }
module.exports = { isOwner, isAdmin, isManagement };
