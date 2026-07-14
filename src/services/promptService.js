const escapeHtml = require('../utils/html');
const { promptButtons } = require('../keyboards/main');

function buildPromptText(prompt) {
  const tools = prompt.tools?.length ? prompt.tools.map(escapeHtml).join('، ') : 'ذکر نشده';
  const tip = prompt.usageTip ? `\n\n💡 <b>نکته استفاده بهتر:</b>\n<blockquote>${escapeHtml(prompt.usageTip)}</blockquote>` : '';
  return `✨ <b>پرامپت ${escapeHtml(prompt.title)}</b>\n\n<pre>${escapeHtml(prompt.promptText)}</pre>${tip}\n\n🧪 <b>تست‌شده با:</b>\n${tools}\n\n━━━━━━━━━━━━━━━\n🚀 <b>Sinior Ai</b> | مرجع آموزش و پرامپت‌های هوش مصنوعی`;
}

async function sendPrompt(ctx, prompt, isFavorite = false) {
  if (prompt.imageFileId) {
    await ctx.replyWithPhoto(prompt.imageFileId, { caption: `✨ <b>${escapeHtml(prompt.title)}</b>`, parse_mode: 'HTML' });
  }
  return ctx.reply(buildPromptText(prompt), { parse_mode: 'HTML', reply_markup: promptButtons(prompt, isFavorite) });
}
module.exports = { sendPrompt, buildPromptText };
