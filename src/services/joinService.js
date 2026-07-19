const env = require('../config/env');
const Setting = require('../models/Setting');
const RequiredChannel = require('../models/RequiredChannel');
const { isOwner } = require('../utils/access');
const { isAdmin } = require('./adminService');

async function forcedMembershipEnabled() {
  const row = await Setting.findOne({ key: 'forcedMembershipEnabled' }).lean();
  return row ? row.value !== false : true;
}

async function seedRequiredChannels(ownerId = env.ownerId) {
  if (await RequiredChannel.countDocuments()) return;
  const docs = env.requiredChannels.map((channel, index) => ({
    title: channel.username.replace(/^@/, ''), chatId: channel.username,
    inviteLink: channel.url, sortOrder: index, createdBy: ownerId
  }));
  if (docs.length) await RequiredChannel.insertMany(docs, { ordered: false }).catch(() => {});
}

async function getRequiredChannels() {
  await seedRequiredChannels();
  return RequiredChannel.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
}

async function isExempt(telegramId) {
  return isOwner(telegramId) || await isAdmin(telegramId);
}

async function getMissingChannels(ctx, telegramId) {
  if (await isExempt(telegramId) || !(await forcedMembershipEnabled())) return [];
  const missing = [];
  for (const channel of await getRequiredChannels()) {
    try {
      const member = await ctx.telegram.getChatMember(channel.chatId, telegramId);
      if (!['creator', 'administrator', 'member', 'restricted'].includes(member.status)) missing.push(channel);
    } catch (error) {
      console.error(`Join check ${channel.chatId}:`, error.description || error.message);
      missing.push(channel);
    }
  }
  return missing;
}

async function isJoined(ctx, id) { return (await getMissingChannels(ctx, id)).length === 0; }

function membershipKeyboard(channels) {
  const rows = channels.map(channel => [{ text: `📢 ${channel.title}`, url: channel.inviteLink }]);
  rows.push([{ text: '✅ عضو شدم، بررسی کن', callback_data: 'check_join' }]);
  return { inline_keyboard: rows };
}

function globalMembershipMiddleware() {
  const warnedAt = new Map();
  return async (ctx, next) => {
    const id = ctx.from?.id;
    if (!id) return next();
    if (ctx.callbackQuery?.data === 'check_join') return next();
    const missing = await getMissingChannels(ctx, id);
    if (!missing.length) return next();
    if (ctx.callbackQuery) await ctx.answerCbQuery('ابتدا عضویت کانال‌ها را کامل کن.', { show_alert: true }).catch(() => {});
    const now = Date.now();
    if (now - (warnedAt.get(id) || 0) > 10000) {
      warnedAt.set(id, now);
      await ctx.reply('🔒 برای ادامه، ابتدا در کانال‌های زیر عضو شو:', { reply_markup: membershipKeyboard(missing) });
    }
  };
}

module.exports = { isJoined, getMissingChannels, getRequiredChannels, seedRequiredChannels, forcedMembershipEnabled, membershipKeyboard, globalMembershipMiddleware };
