const env = require('../config/env');
const { isOwner } = require('../utils/access');
const { normalizeTelegramUrl } = require('../utils/telegram');

function mainMenu(userId, isAdminUser = false) {
  if (isOwner(userId)) {
    return {
      keyboard: [[{ text: '🛠 پنل ادمین', style: 'primary' }]],
      resize_keyboard: true
    };
  }

  const rows = [
    [{ text: '👤 حساب من' }, { text: '👑 خرید اشتراک', style: 'primary' }],
    [{ text: '🎓 آموزش هوش مصنوعی' }, { text: '❤️ علاقه‌مندی‌ها' }],
    [{ text: '📝 درخواست پرامپت' }, { text: '🎁 دعوت دوستان' }],
    [{ text: '🛟 پشتیبانی' }]
  ];

  if (isAdminUser) rows.push([{ text: '🛠 پنل ادمین' }]);
  return { keyboard: rows, resize_keyboard: true };
}

function promptButtons(prompt, isFavorite = false) {
  const channelUrl = normalizeTelegramUrl(env.channelUrl, env.channelUsername);
  const rows = [
    [
      {
        text: isFavorite ? '🗑 حذف از علاقه‌مندی' : '⭐ افزودن به علاقه‌مندی',
        callback_data: `fav_${prompt._id}`,
        style: 'primary'
      },
      {
        text: '⭐ امتیاز دادن',
        callback_data: `rate_${prompt._id}`,
        style: 'success'
      }
    ],
    [
      {
        text: '🎨 ارسال نتیجه من',
        callback_data: `result_${prompt._id}`,
        style: 'primary'
      },
      {
        text: '👤 حساب من',
        callback_data: 'my_account',
        style: 'success'
      }
    ],
    [{ text: '🏆 مشاهده بهترین نتایج کاربران', callback_data: `gallery_${prompt._id}` }]
  ];

  if (channelUrl) {
    rows.push([{ text: '🔴 مشاهده کانال', url: channelUrl, style: 'danger' }]);
  }

  return { inline_keyboard: rows };
}

function joinButtons(channels = env.requiredChannels) {
  const rows = channels
    .map((channel, index) => {
      const url = normalizeTelegramUrl(channel.inviteLink || channel.url, channel.chatId || channel.username);
      return url ? [{ text: channel.title ? `📢 ${channel.title}` : `عضویت در کانال ${index + 1}`, url, style: 'primary' }] : null;
    })
    .filter(Boolean);

  rows.push([{ text: '🟢 بررسی عضویت‌ها', callback_data: 'check_join', style: 'success' }]);
  return { inline_keyboard: rows };
}

function cancelKeyboard(back = null) {
  const rows = [[{ text: '❌ لغو عملیات', callback_data: 'cancel_input', style: 'danger' }]];
  if (back) rows.push([{ text: '🔙 بازگشت', callback_data: back }]);
  return { inline_keyboard: rows };
}

function promptSkipKeyboard(kind, includeCancel = true) {
  const rows = [[{ text: '⏭ رد شدن از این مرحله', callback_data: `prompt_skip_${kind}` }]];
  if (includeCancel) rows.push([{ text: '❌ لغو عملیات', callback_data: 'cancel_input', style: 'danger' }]);
  return { inline_keyboard: rows };
}

module.exports = {
  mainMenu,
  promptButtons,
  joinButtons,
  cancelKeyboard,
  promptSkipKeyboard
};
