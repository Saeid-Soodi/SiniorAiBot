const escapeHtml = require('../utils/html');
const { promptButtons } = require('../keyboards/main');
const { telegramErrorDetails } = require('../utils/telegram');

function buildPromptText(prompt) {
  const tools = prompt.tools?.length
    ? prompt.tools.map(escapeHtml).join('، ')
    : 'ذکر نشده';

  const tip = prompt.usageTip
    ? `\n\n💡 <b>نکته استفاده بهتر:</b>\n<blockquote>${escapeHtml(prompt.usageTip)}</blockquote>`
    : '';

  return [
    `✨ <b>پرامپت ${escapeHtml(prompt.title)}</b>`,
    '',
    `<pre>${escapeHtml(prompt.promptText)}</pre>${tip}`,
    '',
    '🧪 <b>تست‌شده با:</b>',
    tools,
    '',
    '━━━━━━━━━━━━━━━',
    '🚀 <b>Sinior Ai</b> | مرجع آموزش و پرامپت‌های هوش مصنوعی'
  ].join('\n');
}

async function sendPrompt(ctx, prompt, isFavorite = false) {
  if (prompt.imageFileId) {
    await ctx.replyWithPhoto(prompt.imageFileId, {
      caption: `✨ <b>${escapeHtml(prompt.title)}</b>`,
      parse_mode: 'HTML'
    });
  }

  const text = buildPromptText(prompt);
  const replyMarkup = promptButtons(prompt, isFavorite);

  try {
    return await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    });
  } catch (error) {
    console.error('SEND_PROMPT_WITH_BUTTONS_FAILED', {
      promptId: String(prompt?._id || ''),
      slug: prompt?.slug || null,
      ...telegramErrorDetails(error)
    });

    // The prompt itself is more important than the action buttons. If Telegram rejects
    // a keyboard because of an invalid URL/button, deliver the content and keep a clear log.
    try {
      return await ctx.reply(text, { parse_mode: 'HTML' });
    } catch (fallbackError) {
      console.error('SEND_PROMPT_TEXT_FAILED', {
        promptId: String(prompt?._id || ''),
        slug: prompt?.slug || null,
        ...telegramErrorDetails(fallbackError)
      });
      throw fallbackError;
    }
  }
}

module.exports = { sendPrompt, buildPromptText };
