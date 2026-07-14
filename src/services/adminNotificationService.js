const env = require('../config/env');
const escapeHtml = require('../utils/html');
const { formatToman, formatDateTime } = require('../utils/format');
const Admin = require('../models/Admin');

function displayUser(from) {
  const name = escapeHtml(from.first_name || 'کاربر');
  return from.username ? `${name} (@${escapeHtml(from.username)})` : `${name} — <code>${from.id}</code>`;
}

async function recipients() {
  const admins = await Admin.find({ isActive: true }).select('telegramId').lean();
  return [...new Set([env.ownerId, ...env.adminIds, ...admins.map(a => a.telegramId)].filter(Boolean))];
}

async function notifyPayment(ctx, payment, from) {
  const typeNames = { vip_purchase: 'خرید VIP', vip_renewal: 'تمدید VIP', gift_purchase: 'خرید هدیه', wallet_topup: 'شارژ کیف پول' };
  const caption = `💳 <b>رسید پرداخت جدید</b>\n\n👤 کاربر: ${displayUser(from)}\n🆔 شناسه: <code>${from.id}</code>\n📦 نوع: <b>${typeNames[payment.type] || payment.type}</b>\n💰 مبلغ اصلی: ${formatToman(payment.originalPrice)}\n🎟 تخفیف: ${formatToman(payment.discountAmount)}\n💵 مبلغ نهایی: <b>${formatToman(payment.finalPrice)}</b>\n📅 زمان: ${formatDateTime(payment.createdAt)}\n📌 وضعیت: در انتظار بررسی\n🔖 کد پیگیری: <code>${payment.paymentCode}</code>`;
  const keyboard = { inline_keyboard: [
    [{ text: '✅ تأیید', callback_data: `pay_approve_${payment._id}`, style: 'success' }, { text: '❌ رد', callback_data: `pay_reject_${payment._id}`, style: 'danger' }],
    [{ text: '👤 مشاهده کاربر', callback_data: `a_user_${from.id}` }, { text: '🧾 تاریخچه خرید', callback_data: `a_history_${from.id}` }],
    [{ text: '🏠 منوی پنل', callback_data: 'admin_home' }]
  ] };
  for (const id of await recipients()) await ctx.telegram.sendPhoto(id, payment.receiptFileId, { caption, parse_mode: 'HTML', reply_markup: keyboard }).catch(() => {});
}

async function notifyPromptRequest(ctx, request, from) {
  const caption = `📝 <b>درخواست پرامپت جدید</b>\n\n👤 ${displayUser(from)}\n🆔 <code>${from.id}</code>\n📅 ${formatDateTime(request.createdAt)}\n\n<blockquote>${escapeHtml(request.text)}</blockquote>`;
  const kb = { inline_keyboard: [[{ text: '✅ تأیید', callback_data: `req_approve_${request._id}`, style: 'success' }, { text: '❌ رد', callback_data: `req_reject_${request._id}`, style: 'danger' }], [{ text: '🏠 منوی پنل', callback_data: 'admin_home' }]] };
  for (const id of await recipients()) {
    if (request.imageFileId) await ctx.telegram.sendPhoto(id, request.imageFileId, { caption, parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
    else await ctx.telegram.sendMessage(id, caption, { parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
  }
}

async function notifyPromptResult(ctx, result, prompt, from) {
  const caption = `🎨 <b>نتیجه جدید برای بررسی</b>\n\n✨ پرامپت: ${escapeHtml(prompt?.title || 'نامشخص')}\n👤 ${displayUser(from)}\n🆔 <code>${from.id}</code>\n📅 ${formatDateTime(result.createdAt)}\n\nبرای تأیید، امتیاز ۱ تا ۱۰ انتخاب کن.`;
  const rows = [[1,2,3,4,5].map(n => ({ text: String(n), callback_data: `result_score_${result._id}_${n}` })), [6,7,8,9,10].map(n => ({ text: String(n), callback_data: `result_score_${result._id}_${n}` })), [{ text: '❌ رد نتیجه', callback_data: `result_reject_${result._id}`, style: 'danger' }]];
  for (const id of await recipients()) await ctx.telegram.sendPhoto(id, result.fileId, { caption, parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } }).catch(() => {});
}

async function notifySupportTicket(ctx, ticket, from) {
  const text = `💬 <b>پیام جدید پشتیبانی</b>\n\n👤 ${displayUser(from)}\n🆔 <code>${from.id}</code>\n📅 ${formatDateTime(ticket.createdAt)}\n\n${escapeHtml(ticket.text || 'پیام رسانه‌ای')}`;
  const kb = { inline_keyboard: [[{ text: '💬 پاسخ به کاربر', callback_data: `support_reply_${ticket._id}`, style: 'primary' }], [{ text: '🏠 منوی پنل', callback_data: 'admin_home' }]] };
  await ctx.telegram.sendMessage(env.ownerId, text, { parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
}

module.exports = { notifyPayment, notifyPromptRequest, notifyPromptResult, notifySupportTicket };
