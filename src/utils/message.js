async function editOrReply(ctx, text, extra = {}) {
  if (ctx.callbackQuery?.message) {
    try {
      return await ctx.editMessageText(text, extra);
    } catch (error) {
      const description = error.response?.description || '';
      if (/message is not modified/i.test(description)) return null;
    }
  }
  return ctx.reply(text, extra);
}

async function safeDelete(ctx, messageId) {
  if (!messageId) return;
  try {
    await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
  } catch (_) {}
}

module.exports = { editOrReply, safeDelete };
