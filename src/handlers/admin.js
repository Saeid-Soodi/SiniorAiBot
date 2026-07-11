const env = require('../config/env');
const Prompt = require('../models/Prompt');
const User = require('../models/User');
const Payment = require('../models/Payment');
const AiLesson = require('../models/AiLesson');
const DiscountCode = require('../models/DiscountCode');
const ClickEvent = require('../models/ClickEvent');
const PromptRequest = require('../models/PromptRequest');
const PromptResult = require('../models/PromptResult');
const { consumeCode } = require('../services/discountService');
const { isAdmin, isOwner } = require('../utils/access');
const { formatToman, formatDateTime } = require('../utils/format');

const states = new Map();

function panel() {
  return { inline_keyboard: [
    [{ text: '➕ افزودن پرامپت', callback_data: 'a_add_prompt', style: 'success' }, { text: '📝 پرامپت‌ها', callback_data: 'a_prompts', style: 'primary' }],
    [{ text: '📝 درخواست‌های کاربران', callback_data: 'a_requests' }, { text: '🎨 نتایج کاربران', callback_data: 'a_results' }],
    [{ text: '🎓 آموزش‌ها', callback_data: 'a_lessons' }, { text: '🎟 کد تخفیف', callback_data: 'a_codes' }],
    [{ text: '👥 کاربران', callback_data: 'a_users' }, { text: '🧾 پرداخت‌ها', callback_data: 'a_payments' }],
    [{ text: '📥 صندوق مدیریت', callback_data: 'a_inbox' }],
    [{ text: '📊 آمار', callback_data: 'a_stats' }, { text: '📣 پیام همگانی', callback_data: 'a_broadcast' }]
  ] };
}

async function stats(ctx) {
  const [users, vips, prompts, lessons, pending, clicks, deliveries, purchases, requests, results] = await Promise.all([
    User.countDocuments(), User.countDocuments({ plan: 'vip' }), Prompt.countDocuments(), AiLesson.countDocuments(),
    Payment.countDocuments({ status: 'pending' }), ClickEvent.countDocuments({ event: 'click' }), ClickEvent.countDocuments({ event: 'delivery' }),
    Payment.countDocuments({ status: 'approved' }), PromptRequest.countDocuments({ status: 'pending' }), PromptResult.countDocuments({ status: 'pending' })
  ]);
  return ctx.reply(`📊 آمار\n\nکاربران: ${users}\nVIP: ${vips}\nپرامپت‌ها: ${prompts}\nآموزش‌ها: ${lessons}\nکلیک‌ها: ${clicks}\nتحویل‌ها: ${deliveries}\nخرید موفق: ${purchases}\nرسید معلق: ${pending}\nدرخواست پرامپت: ${requests}\nنتیجه در انتظار بررسی: ${results}`);
}

async function listPrompts(ctx) {
  const rows = await Prompt.find().sort({ createdAt: -1 }).limit(30);
  if (!rows.length) return ctx.reply('پرامپتی نیست.');
  return ctx.reply('📝 پرامپت‌ها', { reply_markup: { inline_keyboard: rows.map(p => [{ text: `${p.isActive ? '✅' : '⛔'} ${p.title}`, callback_data: `a_prompt_${p._id}` }]) } });
}

function registerAdminHandlers(bot) {
  bot.command('admin', ctx => isAdmin(ctx.from.id) ? ctx.reply(isOwner(ctx.from.id) ? '👑 پنل مالک' : '🛠 پنل ادمین', { reply_markup: panel() }) : undefined);
  bot.action('open_admin', async ctx => { if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('دسترسی ندارید.', { show_alert: true }); await ctx.answerCbQuery(); return ctx.reply(isOwner(ctx.from.id) ? '👑 پنل مالک' : '🛠 پنل ادمین', { reply_markup: panel() }); });
  bot.action('a_stats', async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); return stats(ctx); });
  bot.action('a_inbox', async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const [payments, results, requests] = await Promise.all([Payment.countDocuments({ status: 'pending' }), PromptResult.countDocuments({ status: 'pending' }), PromptRequest.countDocuments({ status: 'pending' })]); return ctx.reply(`📥 صندوق مدیریت\n\n💳 رسیدهای در انتظار: ${payments}\n🎨 نتایج در انتظار بررسی: ${results}\n📝 درخواست‌های پرامپت: ${requests}`); });
  bot.action('a_prompts', async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); return listPrompts(ctx); });

  bot.action('a_add_prompt', async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); states.set(ctx.from.id, { type: 'prompt', step: 'title', data: {} }); return ctx.reply('عنوان پرامپت؟'); });
  bot.action(/^a_prompt_(.+)$/, async ctx => {
    if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery();
    const p = await Prompt.findById(ctx.match[1]); if (!p) return;
    const avg = p.ratingCount ? (p.ratingSum / p.ratingCount).toFixed(1) : '-';
    return ctx.reply(`✨ ${p.title}\nslug: ${p.slug}\nclicks: ${p.totalClicks}\nunique: ${p.uniqueClicks}\ndeliveries: ${p.deliveries}\nfavorites: ${p.favoriteCount}\nrating: ${avg}\nresults: ${p.resultCount}`, { reply_markup: { inline_keyboard: [[{ text: '✏️ ویرایش', callback_data: `a_editp_${p._id}` }], [{ text: p.isActive ? '⛔ غیرفعال' : '✅ فعال', callback_data: `a_togglep_${p._id}` }], [{ text: '🗑 حذف', callback_data: `a_deletep_${p._id}`, style: 'danger' }]] } });
  });
  bot.action(/^a_editp_(.+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const p = await Prompt.findById(ctx.match[1]); if (!p) return; states.set(ctx.from.id, { type: 'prompt', mode: 'edit', promptId: p._id, step: 'title', data: { imageFileId: p.imageFileId } }); return ctx.reply(`عنوان جدید؟\nفعلی: ${p.title}`); });
  bot.action(/^a_togglep_(.+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const p = await Prompt.findById(ctx.match[1]); p.isActive = !p.isActive; await p.save(); return ctx.reply('وضعیت تغییر کرد.'); });
  bot.action(/^a_deletep_(.+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); await Prompt.findByIdAndDelete(ctx.match[1]); return ctx.reply('پرامپت حذف شد.'); });

  bot.action('a_requests', async ctx => {
    if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery();
    const rows = await PromptRequest.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(20);
    if (!rows.length) return ctx.reply('درخواست معلقی نیست.');
    return ctx.reply(rows.map(r => `📝 ${r.text}\nکاربر: ${r.userTelegramId}\n/donereq_${r._id}\n/rejectreq_${r._id}`).join('\n\n'));
  });
  bot.hears(/^\/donereq_(.+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; const r = await PromptRequest.findById(ctx.match[1]); if (!r) return; r.status = 'done'; await r.save(); await ctx.telegram.sendMessage(r.userTelegramId, '🎉 درخواست پرامپتت بررسی شد و به فهرست تولید محتوا اضافه شد.').catch(() => {}); return ctx.reply('انجام شد.'); });
  bot.hears(/^\/rejectreq_(.+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; const r = await PromptRequest.findById(ctx.match[1]); if (!r) return; r.status = 'rejected'; await r.save(); return ctx.reply('رد شد.'); });
  bot.action(/^req_done_(.+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const r = await PromptRequest.findById(ctx.match[1]); if (!r) return; r.status = 'done'; await r.save(); await ctx.telegram.sendMessage(r.userTelegramId, '🎉 درخواست پرامپتت بررسی شد و به فهرست تولید محتوا اضافه شد.').catch(() => {}); return ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '✅ انجام‌شده', callback_data: 'noop' }]] }).catch(() => {}); });
  bot.action(/^req_reject_(.+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const r = await PromptRequest.findById(ctx.match[1]); if (!r) return; r.status = 'rejected'; await r.save(); return ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '❌ رد‌شده', callback_data: 'noop' }]] }).catch(() => {}); });

  bot.action('a_results', async ctx => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const rows = await PromptResult.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(10);
    if (!rows.length) return ctx.reply('نتیجه معلقی نیست.');

    for (const r of rows) {
      const prompt = await Prompt.findById(r.promptId);
      const caption = `🎨 نتیجه در انتظار بررسی\nپرامپت: ${prompt?.title || '-'}\nکاربر: ${r.userTelegramId}\n\nبرای تأیید، امتیاز ۱ تا ۱۰ را انتخاب کن.`;
      const reply_markup = { inline_keyboard: [
        [1,2,3,4,5].map(n => ({ text: String(n), callback_data: `result_score_${r._id}_${n}` })),
        [6,7,8,9,10].map(n => ({ text: String(n), callback_data: `result_score_${r._id}_${n}` })),
        [{ text: '❌ رد نتیجه', callback_data: `result_reject_${r._id}`, style: 'danger' }]
      ] };
      if (r.fileType === 'photo') await ctx.replyWithPhoto(r.fileId, { caption, reply_markup });
      else if (r.fileType === 'video') await ctx.replyWithVideo(r.fileId, { caption, reply_markup });
      else await ctx.replyWithDocument(r.fileId, { caption, reply_markup });
    }
  });

  bot.hears(/^\/approveresult_(.+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; const r = await PromptResult.findById(ctx.match[1]); if (!r || r.status !== 'pending') return; r.status = 'approved'; r.reviewedBy = ctx.from.id; r.reviewedAt = new Date(); await r.save(); await Prompt.updateOne({ _id: r.promptId }, { $inc: { resultCount: 1 } }); await ctx.telegram.sendMessage(r.userTelegramId, '✅ نتیجه‌ای که فرستادی تأیید شد و وارد گالری کاربران شد.').catch(() => {}); return ctx.reply('تأیید شد.'); });
  bot.hears(/^\/rejectresult_(.+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; const r = await PromptResult.findById(ctx.match[1]); if (!r || r.status !== 'pending') return; r.status = 'rejected'; r.reviewedBy = ctx.from.id; r.reviewedAt = new Date(); await r.save(); return ctx.reply('رد شد.'); });
  bot.action(/^result_score_(.+)_(10|[1-9])$/, async ctx => {
    if (!isAdmin(ctx.from.id)) return;
    await ctx.answerCbQuery();
    const result = await PromptResult.findById(ctx.match[1]);
    if (!result || result.status !== 'pending') return ctx.answerCbQuery('این نتیجه قبلاً بررسی شده است.', { show_alert: true }).catch(() => {});
    const score = Number(ctx.match[2]);
    result.status = 'approved'; result.adminScore = score; result.reviewedBy = ctx.from.id; result.reviewedAt = new Date(); await result.save();
    await Prompt.updateOne({ _id: result.promptId }, { $inc: { resultCount: 1 } });
    await ctx.telegram.sendMessage(result.userTelegramId, `✅ نتیجه‌ای که فرستادی تأیید شد.\n⭐ امتیاز مدیریت: ${score}/10\n\nنتیجه‌ات حالا می‌تواند در بخش بهترین خروجی‌ها نمایش داده شود. 💜`).catch(() => {});
    return ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: `✅ تأیید شد — ${score}/10`, callback_data: 'noop' }]] }).catch(() => {});
  });
  bot.action(/^result_reject_(.+)$/, async ctx => {
    if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery();
    const result = await PromptResult.findById(ctx.match[1]); if (!result || result.status !== 'pending') return;
    result.status = 'rejected'; result.reviewedBy = ctx.from.id; result.reviewedAt = new Date(); await result.save();
    await ctx.telegram.sendMessage(result.userTelegramId, '❌ نتیجه ارسال‌شده این بار برای نمایش در گالری تأیید نشد. می‌تونی نتیجه بهتری بفرستی.').catch(() => {});
    return ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '❌ رد شد', callback_data: 'noop' }]] }).catch(() => {});
  });

  bot.action('a_lessons', async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const rows = await AiLesson.find().sort({ order: 1, createdAt: 1 }).limit(30); return ctx.reply('🎓 مدیریت آموزش‌ها', { reply_markup: { inline_keyboard: [[{ text: '➕ آموزش جدید', callback_data: 'a_add_lesson', style: 'success' }], ...rows.map(l => [{ text: `${l.isActive ? '✅' : '⛔'} ${l.title}`, callback_data: `a_lesson_${l._id}` }])] } }); });
  bot.action('a_add_lesson', async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); states.set(ctx.from.id, { type: 'lesson', step: 'title', data: {} }); return ctx.reply('عنوان آموزش؟'); });

  bot.action('a_codes', async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const rows = await DiscountCode.find().sort({ createdAt: -1 }).limit(30); return ctx.reply('🎟 کدهای تخفیف', { reply_markup: { inline_keyboard: [[{ text: '➕ کد جدید', callback_data: 'a_add_code', style: 'success' }], ...rows.map(c => [{ text: `${c.isActive ? '✅' : '⛔'} ${c.code}`, callback_data: `a_code_${c._id}` }])] } }); });
  bot.action('a_add_code', async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); states.set(ctx.from.id, { type: 'code', step: 'code', data: {} }); return ctx.reply('کد را بنویس؛ مثال SINIOR40'); });

  bot.action('a_users', async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const rows = await User.find().sort({ createdAt: -1 }).limit(30); return ctx.reply(rows.map(u => `${u.isBlocked ? '⛔' : '👤'} ${u.telegramId} | ${u.firstName || '-'} | ${u.plan}\n/user_${u.telegramId}`).join('\n\n') || 'کاربری نیست.'); });
  bot.hears(/^\/user_(\d+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; const id = Number(ctx.match[1]); const u = await User.findOne({ telegramId: id }); if (!u) return ctx.reply('پیدا نشد.'); const purchases = await Payment.countDocuments({ userTelegramId: id, status: 'approved' }); return ctx.reply(`👤 ${u.firstName || '-'}\nID: ${id}\nPlan: ${u.plan}\nInvites: ${u.validReferralCount}\nPurchases: ${purchases}\nNotes: ${u.notes || '-'}`, { reply_markup: { inline_keyboard: [[{ text: u.isBlocked ? '✅ رفع بن' : '⛔ بن', callback_data: `a_ban_${id}`, style: u.isBlocked ? 'success' : 'danger' }], [{ text: '👑 VIP ۳۰ روزه', callback_data: `a_vip_${id}`, style: 'primary' }, { text: 'رایگان', callback_data: `a_free_${id}` }], [{ text: '✏️ یادداشت', callback_data: `a_note_${id}` }, { text: '🧾 خریدها', callback_data: `a_history_${id}` }]] } }); });
  bot.action(/^a_user_(\d+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const id = Number(ctx.match[1]); const u = await User.findOne({ telegramId: id }); if (!u) return ctx.reply('پیدا نشد.'); const purchases = await Payment.countDocuments({ userTelegramId: id, status: 'approved' }); return ctx.reply(`👤 ${u.firstName || '-'}\nID: ${id}\nPlan: ${u.plan}\nInvites: ${u.validReferralCount}\nPurchases: ${purchases}\nNotes: ${u.notes || '-'}`, { reply_markup: { inline_keyboard: [[{ text: u.isBlocked ? '✅ رفع بن' : '⛔ بن', callback_data: `a_ban_${id}`, style: u.isBlocked ? 'success' : 'danger' }], [{ text: '👑 VIP ۳۰ روزه', callback_data: `a_vip_${id}`, style: 'primary' }, { text: 'رایگان', callback_data: `a_free_${id}` }], [{ text: '✏️ یادداشت', callback_data: `a_note_${id}` }, { text: '🧾 خریدها', callback_data: `a_history_${id}` }]] } }); });
  bot.action(/^a_ban_(\d+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const targetId = Number(ctx.match[1]); if (isOwner(targetId)) return ctx.reply('مالک ربات قابل بن‌شدن نیست.'); const u = await User.findOne({ telegramId: targetId }); if (!u) return; u.isBlocked = !u.isBlocked; await u.save(); return ctx.reply('انجام شد.'); });
  bot.action(/^a_vip_(\d+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); await User.updateOne({ telegramId: Number(ctx.match[1]) }, { plan: 'vip', vipUntil: new Date(Date.now() + env.vipDays * 86400000) }); return ctx.reply('VIP شد.'); });
  bot.action(/^a_free_(\d+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const targetId = Number(ctx.match[1]); if (isOwner(targetId)) return ctx.reply('دسترسی مالک دائمی و نامحدود است.'); await User.updateOne({ telegramId: targetId }, { plan: 'free', vipUntil: null }); return ctx.reply('رایگان شد.'); });
  bot.action(/^a_note_(\d+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); states.set(ctx.from.id, { type: 'note', userId: Number(ctx.match[1]) }); return ctx.reply('یادداشت جدید؟'); });
  bot.action(/^a_history_(\d+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const rows = await Payment.find({ userTelegramId: Number(ctx.match[1]) }).sort({ createdAt: -1 }); return ctx.reply(rows.map(p => `${p.status} | ${p.finalPrice.toLocaleString('fa-IR')} | ${p.createdAt.toLocaleString('fa-IR')}`).join('\n') || 'خریدی نیست.'); });

  bot.action('a_payments', async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const rows = await Payment.find().sort({ createdAt: -1 }).limit(30); return ctx.reply(rows.map(p => `${p.status} | ${p.paymentCode || p._id}\nکاربر: ${p.userTelegramId}\nمبلغ: ${formatToman(p.finalPrice)}\n${formatDateTime(p.createdAt)}`).join('\n\n') || 'پرداختی نیست.'); });
  bot.hears(/^\/approve_(.+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; const p = await Payment.findById(ctx.match[1]); if (!p || p.status !== 'pending') return ctx.reply('نامعتبر.'); p.status = 'approved'; p.reviewedBy = ctx.from.id; p.reviewedAt = new Date(); await p.save(); await User.updateOne({ telegramId: p.userTelegramId }, { plan: 'vip', vipUntil: new Date(Date.now() + env.vipDays * 86400000), appliedDiscountCode: null }); await consumeCode(p.discountCode, p.userTelegramId); await ctx.telegram.sendMessage(p.userTelegramId, `🎉 تبریک! پرداختت تأیید شد و اشتراک VIP فعال شد.\n\nاز این لحظه روزانه ${env.vipDailyLimit} پرامپت در اختیارت قرار داره. 👑`).catch(() => {}); return ctx.reply('تأیید شد.'); });
  bot.hears(/^\/reject_(.+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; const p = await Payment.findById(ctx.match[1]); if (!p || p.status !== 'pending') return ctx.reply('نامعتبر.'); p.status = 'rejected'; p.reviewedBy = ctx.from.id; p.reviewedAt = new Date(); await p.save(); await ctx.telegram.sendMessage(p.userTelegramId, '❌ متأسفانه پرداخت تأیید نشد. اگر فکر می‌کنی اشتباهی رخ داده، با پشتیبانی در ارتباط باش.').catch(() => {}); return ctx.reply('رد شد.'); });

  bot.action(/^pay_approve_(.+)$/, async ctx => {
    if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery();
    const p = await Payment.findById(ctx.match[1]);
    if (!p || p.status !== 'pending') return ctx.answerCbQuery('این پرداخت قبلاً بررسی شده است.', { show_alert: true }).catch(() => {});
    p.status = 'approved'; p.reviewedBy = ctx.from.id; p.reviewedAt = new Date(); await p.save();
    const vipUntil = new Date(Date.now() + env.vipDays * 86400000);
    await User.updateOne({ telegramId: p.userTelegramId }, { plan: 'vip', vipUntil, appliedDiscountCode: null });
    await consumeCode(p.discountCode, p.userTelegramId);
    await ctx.telegram.sendMessage(p.userTelegramId, `🎉 تبریک! پرداختت تأیید شد.\n\n👑 اشتراک VIP فعال شد.\n📅 اعتبار تا: ${vipUntil.toLocaleDateString('fa-IR')}\n🎁 سهمیه روزانه: ${env.vipDailyLimit} پرامپت`).catch(() => {});
    const reviewer = isOwner(ctx.from.id) ? 'Owner' : `Admin ${ctx.from.id}`;
    const caption = `✅ پرداخت تأیید شد\n\n🔖 شناسه: ${p.paymentCode || p._id}\n👤 کاربر: ${p.userTelegramId}\n💵 مبلغ: ${formatToman(p.finalPrice)}\n👑 اشتراک VIP: فعال شد\n📅 اعتبار تا: ${vipUntil.toLocaleDateString('fa-IR')}\n🛡 تأییدکننده: ${reviewer}\n🕒 زمان تأیید: ${formatDateTime(p.reviewedAt)}`;
    return ctx.editMessageCaption(caption, { reply_markup: { inline_keyboard: [[{ text: '✅ تأیید شده', callback_data: 'noop' }]] } }).catch(() => ctx.reply(caption));
  });

  bot.action(/^pay_reject_(.+)$/, async ctx => {
    if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery();
    const p = await Payment.findById(ctx.match[1]); if (!p || p.status !== 'pending') return;
    return ctx.editMessageReplyMarkup({ inline_keyboard: [
      [{ text: '❌ مبلغ اشتباه', callback_data: `pay_reject_reason_${p._id}_amount` }],
      [{ text: '🧾 رسید نامعتبر', callback_data: `pay_reject_reason_${p._id}_invalid` }],
      [{ text: '🔁 رسید تکراری', callback_data: `pay_reject_reason_${p._id}_duplicate` }],
      [{ text: '💳 اطلاعات نامشخص', callback_data: `pay_reject_reason_${p._id}_unclear` }],
      [{ text: '🔙 بازگشت', callback_data: `pay_reject_back_${p._id}` }]
    ] });
  });

  bot.action(/^pay_reject_back_(.+)$/, async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); const p = await Payment.findById(ctx.match[1]); if (!p) return; return ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '✅ تأیید و فعال‌سازی VIP', callback_data: `pay_approve_${p._id}`, style: 'success' }, { text: '❌ رد پرداخت', callback_data: `pay_reject_${p._id}`, style: 'danger' }], [{ text: '👤 مشاهده کاربر', callback_data: `a_user_${p.userTelegramId}` }, { text: '🧾 تاریخچه خرید', callback_data: `a_history_${p.userTelegramId}` }]] }); });

  bot.action(/^pay_reject_reason_(.+)_(amount|invalid|duplicate|unclear)$/, async ctx => {
    if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery();
    const p = await Payment.findById(ctx.match[1]); if (!p || p.status !== 'pending') return;
    const reasons = { amount: 'مبلغ واریزی با مبلغ سفارش مطابقت ندارد.', invalid: 'رسید ارسال‌شده معتبر نیست.', duplicate: 'این رسید قبلاً استفاده شده یا تکراری است.', unclear: 'اطلاعات پرداخت در رسید واضح یا قابل تأیید نیست.' };
    p.status = 'rejected'; p.rejectionReason = reasons[ctx.match[2]]; p.reviewedBy = ctx.from.id; p.reviewedAt = new Date(); await p.save();
    await ctx.telegram.sendMessage(p.userTelegramId, `❌ پرداختت تأیید نشد.\n\nدلیل: ${p.rejectionReason}\n\nمی‌تونی رسید صحیح را دوباره ارسال کنی یا با پشتیبانی در ارتباط باشی.`).catch(() => {});
    const caption = `❌ پرداخت رد شد\n\n🔖 شناسه: ${p.paymentCode || p._id}\n👤 کاربر: ${p.userTelegramId}\n💵 مبلغ: ${formatToman(p.finalPrice)}\n📝 دلیل: ${p.rejectionReason}\n🕒 زمان بررسی: ${formatDateTime(p.reviewedAt)}`;
    return ctx.editMessageCaption(caption, { reply_markup: { inline_keyboard: [[{ text: '❌ رد شده', callback_data: 'noop' }]] } }).catch(() => ctx.reply(caption));
  });

  bot.action('noop', ctx => ctx.answerCbQuery());

  bot.action('a_broadcast', async ctx => { if (!isAdmin(ctx.from.id)) return; await ctx.answerCbQuery(); states.set(ctx.from.id, { type: 'broadcast' }); return ctx.reply('پیام همگانی را بفرست.'); });

  bot.on('message', async (ctx, next) => {
    if (!isAdmin(ctx.from.id)) return next();
    const state = states.get(ctx.from.id);
    if (!state) return next();
    const text = ctx.message.text?.trim();
    if (text === '/cancel') { states.delete(ctx.from.id); return ctx.reply('لغو شد.'); }

    if (state.type === 'broadcast') {
      states.delete(ctx.from.id); const users = await User.find({ isBlocked: false }); let ok = 0, fail = 0;
      for (const u of users) { try { await ctx.telegram.copyMessage(u.telegramId, ctx.chat.id, ctx.message.message_id); ok++; } catch (e) { fail++; if (/blocked|deactivated|chat not found/i.test(e.description || '')) await User.updateOne({ _id: u._id }, { blockedBot: true }); } }
      return ctx.reply(`✅ ${ok}\n❌ ${fail}`);
    }

    if (state.type === 'note') { await User.updateOne({ telegramId: state.userId }, { notes: text || '' }); states.delete(ctx.from.id); return ctx.reply('ذخیره شد.'); }

    if (state.type === 'prompt') {
      if (state.step === 'title') { state.data.title = text; state.step = 'slug'; return ctx.reply('اسلاگ انگلیسی؟'); }
      if (state.step === 'slug') { state.data.slug = text.toLowerCase().replace(/[^a-z0-9-_]/g, '-'); state.step = 'text'; return ctx.reply('متن پرامپت؟'); }
      if (state.step === 'text') { state.data.promptText = text; state.step = 'tip'; return ctx.reply('💡 نکته استفاده بهتر از این پرامپت را بنویس یا skip بزن.'); }
      if (state.step === 'tip') { state.data.usageTip = text === 'skip' ? null : text; state.step = 'tools'; return ctx.reply('ابزارها با ویرگول؟'); }
      if (state.step === 'tools') { state.data.tools = text.split(',').map(v => v.trim()).filter(Boolean); state.step = 'post'; return ctx.reply('لینک پست اصلی کانال یا skip؟'); }
      if (state.step === 'post') { state.data.channelPostUrl = text === 'skip' ? null : text; state.step = 'image'; return ctx.reply('عکس بفرست یا skip/keep.'); }
      if (state.step === 'image') {
        if (ctx.message.photo) state.data.imageFileId = ctx.message.photo.at(-1).file_id;
        else if (text === 'skip') state.data.imageFileId = null;
        else if (text !== 'keep') return ctx.reply('عکس یا skip/keep.');
        let p;
        if (state.mode === 'edit') p = await Prompt.findByIdAndUpdate(state.promptId, state.data, { new: true, runValidators: true });
        else p = await Prompt.create({ ...state.data, createdBy: ctx.from.id });
        states.delete(ctx.from.id);
        return ctx.reply(`✅ ذخیره شد\nhttps://t.me/${env.botUsername}?start=prompt_${p.slug}\nنمونه منبع‌دار:\nhttps://t.me/${env.botUsername}?start=p_ig_${p.slug}`);
      }
    }

    if (state.type === 'lesson') {
      if (state.step === 'title') { state.data.title = text; state.step = 'content'; return ctx.reply('متن آموزش؟'); }
      if (state.step === 'content') { state.data.content = text; state.step = 'image'; return ctx.reply('عکس یا skip؟'); }
      if (state.step === 'image') { if (ctx.message.photo) state.data.imageFileId = ctx.message.photo.at(-1).file_id; else if (text !== 'skip') return ctx.reply('عکس یا skip.'); state.data.order = await AiLesson.countDocuments() + 1; await AiLesson.create({ ...state.data, createdBy: ctx.from.id }); states.delete(ctx.from.id); return ctx.reply('✅ آموزش ثبت شد.'); }
    }

    if (state.type === 'code') {
      if (state.step === 'code') { state.data.code = text.toUpperCase(); state.step = 'type'; return ctx.reply('نوع: percent یا fixed'); }
      if (state.step === 'type') { state.data.type = text === 'fixed' ? 'fixed' : 'percent'; state.step = 'value'; return ctx.reply('مقدار تخفیف؟'); }
      if (state.step === 'value') { state.data.value = Number(text); state.step = 'days'; return ctx.reply('چند روز اعتبار؟'); }
      if (state.step === 'days') { state.data.expiresAt = new Date(Date.now() + Number(text) * 86400000); state.step = 'max'; return ctx.reply('حداکثر استفاده کلی؟'); }
      if (state.step === 'max') { state.data.maxUses = Number(text); await DiscountCode.create({ ...state.data, createdBy: ctx.from.id }); states.delete(ctx.from.id); return ctx.reply('✅ کد ساخته شد.'); }
    }

    return next();
  });
}

module.exports = { registerAdminHandlers, isAdmin };
