const Prompt = require('../models/Prompt');
const User = require('../models/User');
const Payment = require('../models/Payment');
const PromptRequest = require('../models/PromptRequest');
const PromptRating = require('../models/PromptRating');
const PromptResult = require('../models/PromptResult');
const SupportTicket = require('../models/SupportTicket');
const WalletTransaction = require('../models/WalletTransaction');
const env = require('../config/env');
const { mainMenu, joinButtons, promptButtons, cancelKeyboard } = require('../keyboards/main');
const { upsertUser, refreshDailyUsage, getDailyLimit, canReceivePrompt, consumePrompt } = require('../services/userService');
const { isJoined, getMissingChannels } = require('../services/joinService');
const { sendPrompt } = require('../services/promptService');
const { track, trackClick } = require('../services/analyticsService');
const { attachReferrer, validateReferral } = require('../services/referralService');
const { calculatePrice, validateCode } = require('../services/discountService');
const { sendDailyLesson } = require('../services/lessonService');
const { sendHelp } = require('../services/helpService');
const { notifyPayment, notifyPromptRequest, notifyPromptResult, notifySupportTicket } = require('../services/adminNotificationService');
const { setState, getState, clearState } = require('../services/stateManager');
const { activateOrExtendVip } = require('../services/subscriptionService');
const { debitWallet } = require('../services/walletService');
const { redeemGift } = require('../services/giftService');
const { isOwner } = require('../utils/access');
const { isAdmin: isDbAdmin } = require('../services/adminService');
const { editOrReply } = require('../utils/message');
const { formatToman, formatDateTime, makePaymentCode } = require('../utils/format');
const escapeHtml = require('../utils/html');

const pendingPrompt = new Map();
const paymentDraft = new Map();

function parseStart(payload = '') {
  if (payload.startsWith('gift_')) return { type: 'gift', code: payload.slice(5) };
  if (payload.startsWith('ref_')) return { type: 'ref', referrerId: Number(payload.slice(4)), source: 'referral' };
  if (payload.startsWith('p_')) { const [, source, ...rest] = payload.split('_'); return { type: 'prompt', source: source || 'direct', slug: rest.join('_') }; }
  if (payload.startsWith('prompt_')) return { type: 'prompt', source: 'telegram', slug: payload.slice(7) };
  return { type: 'home', source: payload ? 'campaign' : 'direct', campaign: payload || null };
}

function identity(user) {
  if (user.username) return `${escapeHtml(user.firstName || 'کاربر')} (@${escapeHtml(user.username)})`;
  return `${escapeHtml(user.firstName || 'کاربر')} — <code>${user.telegramId}</code>`;
}

async function menuFor(userId) { return mainMenu(userId, await isDbAdmin(userId)); }

async function showAccount(ctx) {
  const user = await upsertUser(ctx.from); await refreshDailyUsage(user);
  const owner = isOwner(ctx.from.id); const limit = getDailyLimit(user);
  const remaining = owner ? 'نامحدود' : Math.max(0, limit - user.dailyUsed);
  const vipRemaining = user.vipUntil && user.vipUntil > new Date() ? Math.ceil((user.vipUntil - Date.now()) / 86400000) : 0;
  const approvedResults = await PromptResult.countDocuments({ userTelegramId: user.telegramId, status: 'approved' });
  const text = `👤 <b>حساب کاربری</b>\n\n👥 حساب: ${identity(user)}\n🏷 وضعیت: ${owner ? '👑 OWNER' : user.plan === 'vip' ? '👑 VIP MEMBER' : 'کاربر رایگان'}\n🎁 سهمیه امروز: ${owner ? 'نامحدود' : `${remaining} از ${limit}`}\n⏳ زمان باقی‌مانده VIP: ${owner ? 'نامحدود' : vipRemaining ? `${vipRemaining} روز` : 'ندارد'}\n💰 موجودی کیف پول: <b>${formatToman(user.walletBalance)}</b>\n❤️ علاقه‌مندی‌ها: ${user.favorites.length}\n🎨 نتایج تأییدشده: ${approvedResults}`;
  const accountRows = [
    [{ text: '🧾 تاریخچه خرید', callback_data: 'account_history' }, { text: '🎨 نتایج من', callback_data: 'account_results' }],
    [{ text: '💰 شارژ کیف پول', callback_data: 'wallet_topup', style: 'primary' }]
  ];
  if (!owner && user.plan === 'vip' && user.vipUntil > new Date()) accountRows.push([{ text: '🔄 تمدید اشتراک', callback_data: 'renew_vip', style: 'primary' }]);
  accountRows.push([{ text: '🔙 بازگشت', callback_data: 'back_home' }]);
  return editOrReply(ctx, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: accountRows } });
}

async function deliverBySlug(ctx, slug, source = 'telegram', campaign = null) {
  const user = await upsertUser(ctx.from, source, campaign); const prompt = await Prompt.findOne({ slug, isActive: true });
  if (!prompt) return ctx.reply('این پرامپت پیدا نشد.');
  await trackClick({ telegramId: user.telegramId, prompt, source, campaign });
  pendingPrompt.set(user.telegramId, { slug, source, campaign, promptId: prompt._id });
  if (!isOwner(user.telegramId) && !(await isJoined(ctx, user.telegramId))) { const missing = await getMissingChannels(ctx, user.telegramId); return ctx.reply('🔒 برای استفاده از ربات ابتدا در کانال‌های زیر عضو شو.', { reply_markup: joinButtons(missing) }); }
  if (!(await canReceivePrompt(user, prompt._id))) return ctx.reply('🚫 سهمیه امروزت تمام شده. با VIP روزانه ۱۰ پرامپت دریافت کن.', { reply_markup: { inline_keyboard: [[{ text: '👑 خرید VIP', callback_data: 'buy_vip', style: 'primary' }]] } });
  await consumePrompt(user, prompt._id); await track({ telegramId: user.telegramId, promptId: prompt._id, source, campaign, event: 'delivery' }); await validateReferral(user, ctx);
  const favorite = user.favorites.some(id => String(id) === String(prompt._id)); return sendPrompt(ctx, prompt, favorite);
}

async function showVip(ctx, mode = 'vip_purchase') {
  const user = await upsertUser(ctx.from); const price = await calculatePrice(user, user.appliedDiscountCode);
  paymentDraft.set(ctx.from.id, { type: mode, ...price });
  const title = mode === 'vip_renewal' ? '🔄 <b>تمدید اشتراک VIP ویژه ۳۰ روزه</b>' : '👑 <b>اشتراک VIP ویژه ۳۰ روزه</b>';
  const text = `${title}\n\n✅ روزانه تا <b>${env.vipDailyLimit} پرامپت</b>\n✅ دسترسی به امکانات VIP و قابلیت‌های ویژه آینده\n✅ استفاده از کمپین‌ها و تخفیف‌های اختصاصی\n✅ تجربه کامل‌تر Sinior Ai\n\n💰 مبلغ اصلی: <code>${price.originalPrice.toLocaleString('fa-IR')} تومان</code>\n🎟 تخفیف: ${formatToman(price.discountAmount)} (${escapeHtml(price.discountLabel)})\n💳 مبلغ قابل پرداخت: <code>${price.finalPrice.toLocaleString('fa-IR')} تومان</code>\n\n💳 شماره کارت:\n<code>${escapeHtml(env.cardNumber)}</code>\n👤 صاحب کارت: <b>${escapeHtml(env.cardHolder)}</b>`;
  return editOrReply(ctx, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
    [{ text: '📋 کپی مبلغ', copy_text: { text: String(price.finalPrice) }, style: 'primary' }, { text: '📋 کپی شماره کارت', copy_text: { text: env.cardNumber }, style: 'success' }],
    [{ text: '🎟 ثبت کد تخفیف', callback_data: 'apply_code' }, { text: '🧾 ارسال رسید پرداخت', callback_data: 'send_receipt', style: 'primary' }],
    [{ text: '💰 پرداخت از کیف پول', callback_data: `wallet_buy_${mode}` }],
    [{ text: '🎁 خرید اشتراک هدیه', callback_data: 'gift_buy' }],
    [{ text: '❌ انصراف', callback_data: 'back_home', style: 'danger' }]
  ] } });
}

async function processReceipt(ctx, state) {
  const photo = ctx.message.photo?.at(-1)?.file_id; if (!photo) return ctx.reply('لطفاً تصویر رسید را ارسال کن یا عملیات را لغو کن.', { reply_markup: cancelKeyboard() });
  const draft = state.data;
  const payment = await Payment.create({ userTelegramId: ctx.from.id, type: draft.type, receiptFileId: photo, originalPrice: draft.originalPrice, discountAmount: draft.discountAmount || 0, finalPrice: draft.finalPrice, requestedAmount: draft.requestedAmount || null, discountSource: draft.discountSource || 'none', discountCode: draft.discountCode || null, paymentCode: makePaymentCode(ctx.from.id) });
  clearState(ctx.from.id); paymentDraft.delete(ctx.from.id); await notifyPayment(ctx, payment, ctx.from);
  return ctx.reply('⏳ رسید پرداختت دریافت شد. بعد از بررسی مدیریت، نتیجه از همین ربات بهت اعلام می‌شود.');
}

function registerUserHandlers(bot) {
  bot.command('help', sendHelp);
  bot.start(async ctx => {
    const info = parseStart(ctx.startPayload || ''); let user = await upsertUser(ctx.from, info.source, info.campaign);
    if (info.type === 'gift') { try { const result = await redeemGift(info.code, ctx.from.id); return ctx.reply(`🎁 هدیه با موفقیت فعال شد!\n👑 VIP تا ${result.user.vipUntil.toLocaleDateString('fa-IR')} فعال است.`, { reply_markup: await menuFor(ctx.from.id) }); } catch (e) { return ctx.reply(`❌ ${e.message}`, { reply_markup: await menuFor(ctx.from.id) }); } }
    if (info.type === 'ref') user = await attachReferrer(user, info.referrerId);
    if (info.type === 'prompt') return deliverBySlug(ctx, info.slug, info.source, info.campaign);
    const welcome = isOwner(ctx.from.id) ? '👑 شما مالک ربات هستید و دسترسی کامل دارید.' : `🎁 امروز ${env.freeDailyLimit} پرامپت رایگان در اختیار داری.`;
    return ctx.reply(`👋 سلام ${ctx.from.first_name || ''}، خوش اومدی.\n\nبه Sinior Ai خوش اومدی؛ مرجع آموزش و پرامپت‌های هوش مصنوعی.\n\n${welcome}`, { reply_markup: await menuFor(ctx.from.id) });
  });

  bot.action('back_home', async ctx => { await ctx.answerCbQuery(); clearState(ctx.from.id); return ctx.reply('منوی اصلی', { reply_markup: await menuFor(ctx.from.id) }); });
  bot.action('help_lessons', async ctx => { await ctx.answerCbQuery(); return sendDailyLesson(ctx); });
  bot.action('help_support', async ctx => { await ctx.answerCbQuery(); return ctx.reply('🛟 پشتیبانی Sinior Ai', { reply_markup: { inline_keyboard: [[{ text: '🌐 شبکه‌های اجتماعی سینیور', callback_data: 'socials' }], [{ text: '💬 ارسال پیام به پشتیبانی', callback_data: 'support_message', style: 'primary' }]] } }); });
  bot.action('cancel_input', async ctx => { clearState(ctx.from.id); paymentDraft.delete(ctx.from.id); await ctx.answerCbQuery('عملیات لغو شد.'); return ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {}); });
  bot.action('check_join', async ctx => { await ctx.answerCbQuery(); if (!(await isJoined(ctx, ctx.from.id))) { const missing = await getMissingChannels(ctx, ctx.from.id); return ctx.reply('هنوز عضویت در کانال‌های زیر کامل نشده است.', { reply_markup: joinButtons(missing) }); } const p = pendingPrompt.get(ctx.from.id); return p ? deliverBySlug(ctx, p.slug, p.source, p.campaign) : ctx.reply('✅ عضویت تأیید شد.'); });

  bot.hears('👤 حساب من', showAccount); bot.action('my_account', async ctx => { await ctx.answerCbQuery(); return showAccount(ctx); });
  bot.hears('👑 خرید اشتراک', ctx => showVip(ctx)); bot.action('buy_vip', async ctx => { await ctx.answerCbQuery(); return showVip(ctx); });
  bot.action('renew_vip', async ctx => { await ctx.answerCbQuery(); return showVip(ctx, 'vip_renewal'); });
  bot.hears('🎓 آموزش هوش مصنوعی', sendDailyLesson);

  bot.action('account_history', async ctx => { await ctx.answerCbQuery(); const rows = await Payment.find({ userTelegramId: ctx.from.id, status: 'approved' }).sort({ createdAt: -1 }).limit(20); const text = rows.length ? rows.map(p => `🧾 <b>${p.paymentCode}</b>\nنوع: ${p.type}\nمبلغ: ${formatToman(p.finalPrice)}\nتاریخ: ${formatDateTime(p.createdAt)}`).join('\n\n') : 'هنوز پرداخت تأییدشده‌ای نداری.'; return editOrReply(ctx, text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت', callback_data: 'my_account' }]] } }); });
  bot.action('account_results', async ctx => { await ctx.answerCbQuery(); const rows = await PromptResult.find({ userTelegramId: ctx.from.id, status: 'approved' }).sort({ createdAt: -1 }).limit(10); if (!rows.length) return ctx.reply('هنوز نتیجه تأییدشده‌ای نداری.'); for (const r of rows) await ctx.replyWithPhoto(r.fileId, { caption: `⭐ امتیاز مدیریت: ${r.adminScore || '-'} / 10` }).catch(() => {}); });

  bot.action('wallet_topup', async ctx => { await ctx.answerCbQuery(); setState(ctx.from.id, 'wallet_amount'); return ctx.reply(`💰 مبلغ موردنظر برای شارژ کیف پول را به تومان بفرست.\n\nبرای مبالغ بالای ${formatToman(env.walletHighAmountThreshold)} لطفاً قبل از پرداخت با پشتیبانی هماهنگ کن.`, { reply_markup: cancelKeyboard('my_account') }); });
  bot.action(/^wallet_buy_(vip_purchase|vip_renewal)$/, async ctx => { await ctx.answerCbQuery(); const draft = paymentDraft.get(ctx.from.id); if (!draft) return showVip(ctx, ctx.match[1]); const user = await User.findOne({ telegramId: ctx.from.id }); if ((user.walletBalance || 0) < draft.finalPrice) return ctx.answerCbQuery('موجودی کیف پول کافی نیست.', { show_alert: true }); setState(ctx.from.id, 'wallet_confirm_purchase', { ...draft, type: ctx.match[1] }); return ctx.reply(`💰 مبلغ ${formatToman(draft.finalPrice)} از کیف پولت کسر شود؟`, { reply_markup: { inline_keyboard: [[{ text: '✅ تأیید خرید', callback_data: 'wallet_confirm', style: 'success' }], [{ text: '❌ لغو', callback_data: 'cancel_input', style: 'danger' }]] } }); });
  bot.action('wallet_confirm', async ctx => { await ctx.answerCbQuery(); const state = getState(ctx.from.id); if (!state || state.type !== 'wallet_confirm_purchase') return; await debitWallet(ctx.from.id, state.data.finalPrice, { description: 'خرید/تمدید VIP' }); const user = await activateOrExtendVip(ctx.from.id, env.vipDays); clearState(ctx.from.id); return ctx.reply(`✅ خرید با موفقیت انجام شد.\n👑 VIP تا ${user.vipUntil.toLocaleDateString('fa-IR')} فعال است.`); });

  bot.action('apply_code', async ctx => { await ctx.answerCbQuery(); setState(ctx.from.id, 'discount_code'); return ctx.reply('🎟 کد تخفیف را ارسال کن.', { reply_markup: cancelKeyboard('buy_vip') }); });
  bot.action('send_receipt', async ctx => { await ctx.answerCbQuery(); const draft = paymentDraft.get(ctx.from.id); if (!draft) return showVip(ctx); setState(ctx.from.id, 'receipt', draft); return ctx.reply('🧾 حالا تصویر رسید پرداخت را ارسال کن.', { reply_markup: cancelKeyboard('buy_vip') }); });
  bot.action('gift_buy', async ctx => { await ctx.answerCbQuery(); const user = await upsertUser(ctx.from); const price = await calculatePrice(user, user.appliedDiscountCode); paymentDraft.set(ctx.from.id, { type: 'gift_purchase', ...price }); return ctx.reply(`🎁 بعد از تأیید پرداخت، یک لینک هدیه یک‌بارمصرف ساخته می‌شود. دوستت با بازکردن لینک، VIP سی‌روزه دریافت می‌کند.\n\nمبلغ: ${formatToman(price.finalPrice)}`, { reply_markup: { inline_keyboard: [[{ text: '🧾 ارسال رسید هدیه', callback_data: 'send_receipt', style: 'primary' }], [{ text: '🔙 بازگشت', callback_data: 'buy_vip' }]] } }); });

  bot.hears('❤️ علاقه‌مندی‌ها', async ctx => { const user = await User.findOne({ telegramId: ctx.from.id }).populate('favorites'); if (!user?.favorites?.length) return ctx.reply('هنوز پرامپتی ذخیره نکردی.'); for (const p of user.favorites.slice(0, 20)) await ctx.reply(`⭐ ${p.title}`, { reply_markup: { inline_keyboard: [[{ text: '🗑 حذف از علاقه‌مندی', callback_data: `fav_${p._id}`, style: 'danger' }], [{ text: 'مشاهده', callback_data: `viewfav_${p._id}` }]] } }); });
  bot.action(/^fav_(.+)$/, async ctx => { await ctx.answerCbQuery(); const user = await User.findOne({ telegramId: ctx.from.id }); const id = ctx.match[1]; const exists = user.favorites.some(x => String(x) === id); if (exists) user.favorites = user.favorites.filter(x => String(x) !== id); else user.favorites.push(id); await user.save(); await Prompt.updateOne({ _id: id }, { $inc: { favoriteCount: exists ? -1 : 1 } }); const p = await Prompt.findById(id); return ctx.editMessageReplyMarkup(promptButtons(p, !exists)).catch(() => ctx.answerCbQuery(exists ? 'حذف شد' : 'ذخیره شد')); });
  bot.action(/^viewfav_(.+)$/, async ctx => { await ctx.answerCbQuery(); const p = await Prompt.findById(ctx.match[1]); if (p) return sendPrompt(ctx, p, true); });

  bot.action(/^rate_(.+)$/, async ctx => { await ctx.answerCbQuery(); const id = ctx.match[1]; return ctx.reply('امتیازت را انتخاب کن:', { reply_markup: { inline_keyboard: [[1,2,3,4,5].map(n => ({ text: `${n}⭐`, callback_data: `rateval_${id}_${n}` }))] } }); });
  bot.action(/^rateval_(.+)_([1-5])$/, async ctx => { await ctx.answerCbQuery(); const promptId = ctx.match[1], value = Number(ctx.match[2]); await PromptRating.findOneAndUpdate({ userTelegramId: ctx.from.id, promptId }, { rating: value }, { upsert: true, new: true }); return ctx.reply(`✅ امتیاز ${value} از ۵ ثبت شد.`); });
  bot.action(/^result_(.+)$/, async ctx => { await ctx.answerCbQuery(); setState(ctx.from.id, 'prompt_result', { promptId: ctx.match[1] }); return ctx.reply('🎨 تصویر نتیجه‌ای که ساختی را بفرست. بعد از تأیید مدیریت ممکن است در بخش بهترین نتایج نمایش داده شود.', { reply_markup: cancelKeyboard() }); });
  bot.action(/^gallery_(.+)$/, async ctx => { await ctx.answerCbQuery(); const rows = await PromptResult.find({ promptId: ctx.match[1], status: 'approved', adminScore: { $ne: null } }).sort({ adminScore: -1, createdAt: -1 }).limit(3); if (!rows.length) return ctx.reply('هنوز نتیجه تأییدشده‌ای وجود ندارد.'); for (let i=0;i<rows.length;i++) await ctx.replyWithPhoto(rows[i].fileId,{caption:`${['🥇','🥈','🥉'][i]} امتیاز مدیریت: ${rows[i].adminScore}/10`}); });

  bot.hears('📝 درخواست پرامپت', ctx => { setState(ctx.from.id, 'prompt_request_text'); return ctx.reply('📝 ایده یا پرامپت موردنظرت را بفرست. بعد از آن می‌توانی یک تصویر نمونه هم اضافه کنی. درخواست بررسی می‌شود و در صورت تأیید ممکن است در کانال منتشر شود.', { reply_markup: cancelKeyboard() }); });
  bot.hears('🎁 دعوت دوستان', async ctx => { const user = await upsertUser(ctx.from); const link = `https://t.me/${env.botUsername}?start=ref_${user.telegramId}`; return ctx.reply(`🎁 <b>با Sinior Ai هوش مصنوعی رو با دوستات تجربه کن</b>\n\nلینک اختصاصی‌ات رو برای دوستانت بفرست.\n🔥 کمپین فعلی: با دعوت ${env.referralRequired} دوست معتبر، <b>${env.referralDiscountPercent}٪ تخفیف</b> خرید VIP می‌گیری.\n\nدعوت‌های معتبر: ${user.validReferralCount} از ${env.referralRequired}\n\n<code>${link}</code>\n\n📢 ${env.channelUsername}\n🤖 @${env.botUsername}\n\nمنتظر کمپین‌ها و جایزه‌های بعدی Sinior Ai باش. 💜`, { parse_mode: 'HTML' }); });

  bot.hears('🛟 پشتیبانی', ctx => ctx.reply('🛟 پشتیبانی Sinior Ai', { reply_markup: { inline_keyboard: [[{ text: '🌐 شبکه‌های اجتماعی سینیور', callback_data: 'socials' }], [{ text: '💬 ارسال پیام به پشتیبانی', callback_data: 'support_message', style: 'primary' }]] } }));
  bot.action('socials', async ctx => { await ctx.answerCbQuery(); return ctx.reply(`🌐 شبکه‌های اجتماعی Sinior Ai\n\n📢 تلگرام: ${env.channelUsername}\n🤖 ربات: @${env.botUsername}${env.instagramUsername ? `\n📸 اینستاگرام: @${env.instagramUsername}` : ''}`); });
  bot.action('support_message', async ctx => { await ctx.answerCbQuery(); setState(ctx.from.id, 'support_message'); return ctx.reply('💬 پیام خودت را برای پشتیبانی بفرست. مالک ربات می‌تواند از داخل پنل پاسخ دهد.', { reply_markup: cancelKeyboard() }); });

  bot.on('message', async (ctx, next) => {
    const state = getState(ctx.from.id); if (!state) return next();
    const text = ctx.message.text?.trim();
    if (text?.startsWith('/')) { clearState(ctx.from.id); return next(); }
    if (state.type === 'receipt') return processReceipt(ctx, state);
    if (state.type === 'discount_code') { try { const user = await User.findOne({ telegramId: ctx.from.id }); const code = await validateCode(text, user); user.appliedDiscountCode = code.code; await user.save(); clearState(ctx.from.id); return showVip(ctx); } catch (e) { return ctx.reply(`❌ ${e.message}`); } }
    if (state.type === 'wallet_amount') { const amount = Number(String(text || '').replace(/[,،\s]/g,'')); if (!Number.isFinite(amount) || amount < env.minPaymentToman) return ctx.reply(`مبلغ معتبر وارد کن. حداقل ${formatToman(env.minPaymentToman)}.`); if (amount >= env.walletHighAmountThreshold) { clearState(ctx.from.id); return ctx.reply('برای شارژهای با مبلغ بالا لازم است قبل از پرداخت با پشتیبانی هماهنگ کنی.', { reply_markup: { inline_keyboard: [[{ text: '💬 تماس با پشتیبانی', callback_data: 'support_message' }]] } }); } const draft = { type: 'wallet_topup', originalPrice: amount, finalPrice: amount, requestedAmount: amount, discountAmount: 0, discountSource: 'none' }; paymentDraft.set(ctx.from.id, draft); setState(ctx.from.id, 'receipt', draft); return ctx.reply(`💰 مبلغ شارژ: <code>${amount.toLocaleString('fa-IR')} تومان</code>\n💳 شماره کارت: <code>${env.cardNumber}</code>\n👤 صاحب کارت: <b>${escapeHtml(env.cardHolder)}</b>\n\nحالا تصویر رسید را بفرست.`, { parse_mode: 'HTML', reply_markup: cancelKeyboard('my_account') }); }
    if (state.type === 'prompt_result') { const fileId = ctx.message.photo?.at(-1)?.file_id; if (!fileId) return ctx.reply('لطفاً تصویر نتیجه را ارسال کن.'); const result = await PromptResult.create({ userTelegramId: ctx.from.id, promptId: state.data.promptId, fileId, fileType: 'photo' }); const prompt = await Prompt.findById(state.data.promptId); clearState(ctx.from.id); await notifyPromptResult(ctx, result, prompt, ctx.from); return ctx.reply('🎨 نتیجه‌ات دریافت شد. بعد از بررسی مدیریت، در صورت تأیید وارد بخش بهترین نتایج می‌شود.'); }
    if (state.type === 'prompt_request_text') { if (!text) return ctx.reply('لطفاً توضیح متنی بفرست.'); setState(ctx.from.id, 'prompt_request_image', { text }); return ctx.reply('🖼 اگر تصویر نمونه داری بفرست؛ در غیر این صورت دکمه «بدون تصویر» را بزن.', { reply_markup: { inline_keyboard: [[{ text: 'بدون تصویر', callback_data: 'request_no_image' }], [{ text: '❌ لغو', callback_data: 'cancel_input', style: 'danger' }]] } }); }
    if (state.type === 'prompt_request_image') { const imageFileId = ctx.message.photo?.at(-1)?.file_id || null; const req = await PromptRequest.create({ userTelegramId: ctx.from.id, text: state.data.text, imageFileId }); clearState(ctx.from.id); await notifyPromptRequest(ctx, req, ctx.from); return ctx.reply('✅ درخواستت ثبت شد و بعد از بررسی نتیجه آن مشخص می‌شود.'); }
    if (state.type === 'support_message') { const ticket = await SupportTicket.create({ userTelegramId: ctx.from.id, text: text || ctx.message.caption || '', fileId: ctx.message.photo?.at(-1)?.file_id || null, fileType: ctx.message.photo ? 'photo' : 'none' }); clearState(ctx.from.id); await notifySupportTicket(ctx, ticket, ctx.from); return ctx.reply('✅ پیامت برای پشتیبانی ارسال شد.'); }
    return next();
  });

  bot.action('request_no_image', async ctx => { await ctx.answerCbQuery(); const state = getState(ctx.from.id); if (!state || state.type !== 'prompt_request_image') return; const req = await PromptRequest.create({ userTelegramId: ctx.from.id, text: state.data.text }); clearState(ctx.from.id); await notifyPromptRequest(ctx, req, ctx.from); return ctx.reply('✅ درخواستت ثبت شد و بعد از بررسی نتیجه آن مشخص می‌شود.'); });
}

module.exports = { registerUserHandlers };
