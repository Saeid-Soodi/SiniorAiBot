const env = require('../config/env');
const { isOwner } = require('../utils/access');

async function getMissingChannels(ctx, telegramId) {
  if (isOwner(telegramId)) return [];
  const missing = [];
  for (const channel of env.requiredChannels) {
    try {
      const member = await ctx.telegram.getChatMember(channel.username, telegramId);
      if (!['creator', 'administrator', 'member', 'restricted'].includes(member.status)) missing.push(channel);
    } catch (error) {
      console.error(`Join check ${channel.username}:`, error.description || error.message);
      missing.push(channel);
    }
  }
  return missing;
}

async function isJoined(ctx, id) {
  return (await getMissingChannels(ctx, id)).length === 0;
}

module.exports = { isJoined, getMissingChannels };
