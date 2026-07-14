const env = require('../config/env');
const { isOwner } = require('../utils/access');

function mainMenu(userId, isAdminUser = false) {
  if (isOwner(userId)) {
    return { keyboard: [[{ text: '🛠 پنل ادمین', style: 'primary' }]], resize_keyboard: true };
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
  return { inline_keyboard: [
    [
      { text: isFavorite ? '🗑 حذف از علاقه‌مندی' : '⭐ افزودن به علاقه‌مندی', callback_data: `fav_${prompt._id}`, style: 'primary' },
      { text: '⭐ امتیاز دادن', callback_data: `rate_${prompt._id}`, style: 'success' }
    ],
    [
      { text: '🎨 ارسال نتیجه من', callback_data: `result_${prompt._id}`, style: 'primary' },
      { text: '👤 حساب من', callback_data: 'my_account', style: 'success' }
    ],
    [{ text: '🏆 مشاهده بهترین نتایج کاربران', callback_data: `gallery_${prompt._id}` }],
    [{ text: '🔴 مشاهده کانال', url: env.channelUrl, style: 'danger' }]
  ] };
}

function joinButtons() {
  const rows = env.requiredChannels.map((c, i) => [{ text: `عضویت در کانال ${i + 1}`, url: c.url, style: 'primary' }]);
  rows.push([{ text: '🟢 بررسی عضویت‌ها', callback_data: 'check_join', style: 'success' }]);
  return { inline_keyboard: rows };
}

function cancelKeyboard(back = null) {
  const rows = [[{ text: '❌ لغو عملیات', callback_data: 'cancel_input', style: 'danger' }]];
  if (back) rows.push([{ text: '🔙 بازگشت', callback_data: back }]);
  return { inline_keyboard: rows };
}

module.exports = { mainMenu, promptButtons, joinButtons, cancelKeyboard };
