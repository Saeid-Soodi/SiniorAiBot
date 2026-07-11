async function reactToMessage(ctx, emoji = '❤️') {
  if (!ctx.message) return;
  try {
    await ctx.telegram.callApi('setMessageReaction', {
      chat_id: ctx.chat.id,
      message_id: ctx.message.message_id,
      reaction: [{ type: 'emoji', emoji }],
      is_big: false
    });
  } catch (error) {
    console.warn('Reaction skipped:', error.description || error.message);
  }
}
module.exports = { reactToMessage };
