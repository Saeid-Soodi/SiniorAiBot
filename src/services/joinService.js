const env = require('../config/env');
const Setting = require('../models/Setting');
const RequiredChannel = require('../models/RequiredChannel');

function normalizeChatId(value) {
  const clean = String(value || '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');
  return clean ? `@${clean}` : '';
}

async function forcedMembershipEnabled() {
  const row = await Setting.findOne({ key: 'forcedMembershipEnabled' }).lean();
  return row ? row.value !== false : true;
}

// Synchronize cPanel env channels on every startup. Existing panel-managed channels are preserved.
async function seedRequiredChannels(ownerId = env.ownerId) {
  for (let index = 0; index < env.requiredChannels.length; index += 1) {
    const item = env.requiredChannels[index];
    const chatId = normalizeChatId(item.username);
    if (!chatId) continue;
    await RequiredChannel.findOneAndUpdate(
      { chatId: { $regex: `^${chatId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
      {
        $set: {
          title: chatId.slice(1),
          chatId,
          inviteLink: item.url || `https://t.me/${chatId.slice(1)}`,
          isActive: true,
          sortOrder: index
        },
        $setOnInsert: { createdBy: ownerId }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}

async function getRequiredChannels() {
  await seedRequiredChannels();
  return RequiredChannel.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).lean();
}

function isExplicitlyExempt(telegramId) {
  return env.forceJoinExemptIds.includes(Number(telegramId));
}

function hasJoinedStatus(member) {
  if (!member) return false;
  if (['creator', 'administrator', 'member'].includes(member.status)) return true;
  // Restricted users are members only while is_member is true.
  return member.status === 'restricted' && member.is_member === true;
}

async function getMissingChannels(ctx, telegramId) {
  if (!(await forcedMembershipEnabled()) || isExplicitlyExempt(telegramId)) return [];
  const missing = [];
  for (const channel of await getRequiredChannels()) {
    try {
      const member = await ctx.telegram.getChatMember(channel.chatId, telegramId);
      if (!hasJoinedStatus(member)) missing.push(channel);
    } catch (error) {
      // Fail closed: API errors must never grant access.
      console.error(`Join check ${channel.chatId} for ${telegramId}:`, error.description || error.message);
      missing.push(channel);
    }
  }
  return missing;
}

async function isJoined(ctx, id) {
  return (await getMissingChannels(ctx, id)).length === 0;
}

function membershipKeyboard(channels) {
  const rows = channels.map(channel => [{
    text: `📢 ${channel.title}`,
    url: channel.inviteLink || `https://t.me/${String(channel.chatId).replace(/^@/, '')}`
  }]);
  rows.push([{ text: '✅ عضو شدم، بررسی کن', callback_data: 'check_join' }]);
  return { inline_keyboard: rows };
}

function globalMembershipMiddleware() {
  return async (ctx, next) => {
    const id = ctx.from?.id;
    if (!id) return next();
    // check_join handler must run so it can re-check and continue a pending deep link.
    if (ctx.callbackQuery?.data === 'check_join') return next();

    const missing = await getMissingChannels(ctx, id);
    if (!missing.length) return next();

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('ابتدا عضویت کانال‌ها را کامل کن.', { show_alert: true }).catch(() => {});
    }
    return ctx.reply('🔒 برای ادامه، ابتدا در همه کانال‌های زیر عضو شو:', {
      reply_markup: membershipKeyboard(missing)
    });
  };
}

module.exports = {
  isJoined,
  getMissingChannels,
  getRequiredChannels,
  seedRequiredChannels,
  forcedMembershipEnabled,
  membershipKeyboard,
  globalMembershipMiddleware
};
