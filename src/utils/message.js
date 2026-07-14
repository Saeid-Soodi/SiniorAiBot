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


async function sendLongMessage(ctx, text, extra = {}, options = {}) {
  const maxLength = Number(options.maxLength || 3800);
  const normalized = String(text || '').trim();
  if (!normalized) return [];

  const parts = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) splitAt = remaining.lastIndexOf(' ', maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) splitAt = maxLength;

    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) parts.push(remaining);

  const sent = [];
  for (let i = 0; i < parts.length; i += 1) {
    const isLast = i === parts.length - 1;
    const partExtra = { ...extra };
    if (!isLast && partExtra.reply_markup) delete partExtra.reply_markup;
    sent.push(await ctx.reply(parts[i], partExtra));
  }
  return sent;
}

module.exports = { editOrReply, safeDelete, sendLongMessage };
