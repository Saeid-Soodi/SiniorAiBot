const env = require('../config/env');
const escapeHtml = require('../utils/html');
const { formatToman, formatDateTime } = require('../utils/format');

function displayUser(from) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'بدون نام';
  const username = from.username ? `@${from.username}` : 'بدون یوزرنیم';
  return `${escapeHtml(name)} (${escapeHtml(username)})`;
}

async function notifyManagers(ctx, method, ...args) {
  const results = [];
  for (const id of env.managementIds) {
    try {
      results.push(await ctx.telegram[method](id, ...args));
    } catch (error) {
      console.error(`Admin notification failed for ${id}:`, error.description || error.message);
    }
  }
  return results;
}

async function notifyPayment(ctx, payment, from) {
  const caption = `💳 <b>رسید پرداخت جدید</b>\n\n👤 کاربر: ${displayUser(from)}\n🆔 شناسه تلگرام: <code>${from.id}</code>\n👑 پلن: VIP - ${env.vipDays} روزه\n📦 سهمیه: روزانه ${env.vipDailyLimit} پرامپت\n\n💰 مبلغ اصلی: ${formatToman(payment.originalPrice)}\n🎟 تخفیف: ${formatToman(payment.discountAmount)}\n🏷 منبع تخفیف: ${escapeHtml(payment.discountSource || 'بدون تخفیف')}\n💵 مبلغ نهایی: <b>${formatToman(payment.finalPrice)}</b>\n\n📅 زمان ارسال: ${formatDateTime(payment.createdAt)}\n📌 وضعیت: در انتظار بررسی\n🔖 شناسه پرداخت: <code>${payment.paymentCode}</code>`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ تأیید و فعال‌سازی VIP', callback_data: `pay_approve_${payment._id}`, style: 'success' },
        { text: '❌ رد پرداخت', callback_data: `pay_reject_${payment._id}`, style: 'danger' }
      ],
      [
        { text: '👤 مشاهده کاربر', callback_data: `a_user_${from.id}` },
        { text: '🧾 تاریخچه خرید', callback_data: `a_history_${from.id}` }
      ]
    ]
  };

  for (const id of env.managementIds) {
    await ctx.telegram.sendPhoto(id, payment.receiptFileId, {
      caption,
      parse_mode: 'HTML',
      reply_markup: keyboard
    }).catch(error => console.error(`Payment notification failed for ${id}:`, error.description || error.message));
  }
}

async function notifyPromptRequest(ctx, request, from) {
  const text = `📝 <b>درخواست پرامپت جدید</b>\n\n👤 کاربر: ${displayUser(from)}\n🆔 شناسه: <code>${from.id}</code>\n📅 زمان: ${formatDateTime(request.createdAt)}\n\n<blockquote>${escapeHtml(request.text)}</blockquote>`;
  for (const id of env.managementIds) {
    await ctx.telegram.sendMessage(id, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[
        { text: '✅ انجام شد', callback_data: `req_done_${request._id}`, style: 'success' },
        { text: '❌ رد درخواست', callback_data: `req_reject_${request._id}`, style: 'danger' }
      ], [{ text: '👤 مشاهده کاربر', callback_data: `a_user_${from.id}` }]] }
    }).catch(() => {});
  }
}

async function notifyPromptResult(ctx, result, prompt, from) {
  const caption = `🎨 <b>نتیجه جدید برای بررسی</b>\n\n✨ پرامپت: ${escapeHtml(prompt?.title || 'نامشخص')}\n👤 کاربر: ${displayUser(from)}\n🆔 شناسه: <code>${from.id}</code>\n📅 زمان: ${formatDateTime(result.createdAt)}\n\nبرای تأیید، یک امتیاز از ۱ تا ۱۰ انتخاب کن.`;
  const scoreRows = [
    [1, 2, 3, 4, 5].map(n => ({ text: String(n), callback_data: `result_score_${result._id}_${n}` })),
    [6, 7, 8, 9, 10].map(n => ({ text: String(n), callback_data: `result_score_${result._id}_${n}` })),
    [{ text: '❌ رد نتیجه', callback_data: `result_reject_${result._id}`, style: 'danger' }]
  ];

  for (const id of env.managementIds) {
    const extra = { caption, parse_mode: 'HTML', reply_markup: { inline_keyboard: scoreRows } };
    const sender = result.fileType === 'photo' ? 'sendPhoto' : result.fileType === 'video' ? 'sendVideo' : 'sendDocument';
    await ctx.telegram[sender](id, result.fileId, extra).catch(() => {});
  }
}

module.exports = { notifyPayment, notifyPromptRequest, notifyPromptResult };
