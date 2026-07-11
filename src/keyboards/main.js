const env = require('../config/env');
const { isAdmin } = require('../utils/access');

function mainMenu(userId) {
  const rows = [
    [{ text: '👤 حساب من' }, { text: '👑 خرید اشتراک', style: 'primary' }],
    [{ text: '🎓 آموزش هوش مصنوعی' }, { text: '❤️ علاقه‌مندی‌ها' }],
    [{ text: '📝 درخواست پرامپت' }, { text: '🎁 دعوت دوستان' }],
    [{ text: '📞 پشتیبانی' }]
  ];

  if (isAdmin(userId)) rows.push([{ text: '🛠 پنل ادمین' }]);

  return { keyboard: rows, resize_keyboard: true };
}

function promptButtons(prompt, isFavorite = false) {
  return {
    inline_keyboard: [
      [
        {
          text: isFavorite ? '✅ ذخیره‌شده' : '⭐ افزودن به علاقه‌مندی',
          callback_data: `fav_${prompt._id}`,
          style: 'primary'
        },
        { text: '⭐ امتیاز دادن', callback_data: `rate_${prompt._id}`, style: 'success' }
      ],
      [
        { text: '🎨 ارسال نتیجه من', callback_data: `result_${prompt._id}`, style: 'primary' },
        { text: '👤 حساب من', callback_data: 'my_account', style: 'success' }
      ],
      [{ text: '🏆 مشاهده بهترین نتایج کاربران', callback_data: `gallery_${prompt._id}` }],
      [{ text: '🔴 مشاهده پرامپت‌های بیشتر در کانال', url: env.channelUrl, style: 'danger' }]
    ]
  };
}

function joinButtons() {
  const rows = env.requiredChannels.map((c, i) => [{ text: `عضویت در کانال ${i + 1}`, url: c.url, style: 'primary' }]);
  rows.push([{ text: '🟢 بررسی عضویت‌ها', callback_data: 'check_join', style: 'success' }]);
  return { inline_keyboard: rows };
}

function backButton(callbackData = 'back_home') {
  return { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: callbackData }]] };
}

module.exports = { mainMenu, promptButtons, joinButtons, backButton };
