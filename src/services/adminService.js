const Admin = require('../models/Admin');
const env = require('../config/env');

function isOwner(id) { return Number(id) === Number(env.ownerId); }
async function getAdmin(id) {
  if (isOwner(id)) return { telegramId: Number(id), title: 'Owner', isActive: true, permissions: new Proxy({}, { get: () => true }) };
  return Admin.findOne({ telegramId: Number(id), isActive: true }).lean();
}
async function isAdmin(id) { return !!(await getAdmin(id)); }
async function can(id, permission) {
  if (isOwner(id)) return true;
  const admin = await getAdmin(id);
  return !!admin?.permissions?.[permission];
}
module.exports = { isOwner, getAdmin, isAdmin, can };
