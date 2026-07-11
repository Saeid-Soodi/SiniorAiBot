const User = require('../models/User');
const env = require('../config/env');
const { getIranDateKey } = require('../utils/date');
const { isOwner } = require('../utils/access');

async function upsertUser(from, source = 'direct', campaign = null) {
  let user = await User.findOne({ telegramId: from.id });
  if (!user) {
    user = await User.create({
      telegramId: from.id,
      firstName: from.first_name || '',
      username: from.username || '',
      source,
      campaign
    });
  } else {
    user.firstName = from.first_name || '';
    user.username = from.username || '';
    await user.save();
  }
  return normalizePlan(user);
}

async function normalizePlan(user) {
  if (isOwner(user.telegramId)) return user;
  if (user.plan === 'vip' && (!user.vipUntil || user.vipUntil <= new Date())) {
    user.plan = 'free';
    user.vipUntil = null;
    await user.save();
  }
  return user;
}

async function refreshDailyUsage(user) {
  const today = getIranDateKey();
  if (user.usageDate !== today) {
    user.usageDate = today;
    user.dailyUsed = 0;
    await user.save();
  }
  return user;
}

function getDailyLimit(user) {
  if (isOwner(user.telegramId)) return Infinity;
  return user.plan === 'vip' ? env.vipDailyLimit : env.freeDailyLimit;
}

async function canReceivePrompt(user, promptId) {
  if (isOwner(user.telegramId)) return true;
  await normalizePlan(user);
  await refreshDailyUsage(user);
  if (user.receivedPrompts.some(id => String(id) === String(promptId))) return true;
  return user.dailyUsed < getDailyLimit(user);
}

async function consumePrompt(user, promptId) {
  const already = user.receivedPrompts.some(id => String(id) === String(promptId));
  if (already) return false;
  if (!isOwner(user.telegramId)) {
    await refreshDailyUsage(user);
    user.dailyUsed += 1;
  }
  user.receivedPrompts.push(promptId);
  await user.save();
  return true;
}

module.exports = { upsertUser, normalizePlan, refreshDailyUsage, getDailyLimit, canReceivePrompt, consumePrompt };
