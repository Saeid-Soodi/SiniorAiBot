const User = require('../models/User');
const env = require('../config/env');

function addDays(base, days) {
  return new Date(base.getTime() + days * 86400000);
}

async function activateOrExtendVip(telegramId, days = env.vipDays) {
  const user = await User.findOne({ telegramId });
  if (!user) throw new Error('User not found');
  const now = new Date();
  const base = user.vipUntil && user.vipUntil > now ? user.vipUntil : now;
  user.plan = 'vip';
  user.vipUntil = addDays(base, days);
  await user.save();
  return user;
}

module.exports = { activateOrExtendVip };
