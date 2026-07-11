const Prompt = require('../models/Prompt');
const User = require('../models/User');
const Payment = require('../models/Payment');
const PromptRequest = require('../models/PromptRequest');
const PromptRating = require('../models/PromptRating');
const PromptResult = require('../models/PromptResult');
const env = require('../config/env');
const { mainMenu, joinButtons, promptButtons } = require('../keyboards/main');
const { upsertUser, refreshDailyUsage, getDailyLimit, canReceivePrompt, consumePrompt } = require('../services/userService');
const { isJoined } = require('../services/joinService');
const { sendPrompt } = require('../services/promptService');
const { reactToMessage } = require('../services/reactionService');
const { track, trackClick } = require('../services/analyticsService');
const { attachReferrer, validateReferral } = require('../services/referralService');
const { calculatePrice } = require('../services/discountService');
const { sendDailyLesson } = require('../services/lessonService');
const escapeHtml = require('../utils/html');
const { editOrReply } = require('../utils/message');
const { isOwner, isAdmin } = require('../utils/access');
const { makePaymentCode } = require('../utils/format');
const { notifyPayment, notifyPromptRequest, notifyPromptResult } = require('../services/adminNotificationService');

const pendingPrompt = new Map();
const waitingReceipt = new Map(); // draft payment data, not an active input state
const inputState = new Map();

function setInputState(userId, type, data = {}) {
  inputState.set(userId, { type, data });
}

function clearInputState(userId) {
  inputState.delete(userId);
}

function cancelKeyboard() {
  return {
    inline_keyboard: [[
      { text: '❌ لغو عملیات', callback_data: 'cancel_input', style: 'danger' }
    ]]
  };
}

function parseStart(payload) {
  if (payload.startsWith('ref_')) return { type: 'ref', referrerId: Number(payload.slice(4)), source: 'referral' };
  if (payload.startsWith('p_')) {
    const [, source, ...rest] = payload.split('_');
    return { type: 'prompt', source: source || 'direct', slug: rest.join('_') };
  }
  if (payload.startsWith('prompt_')) return { type: 'prompt', source: 'telegram', slug: payload.slice(7) };
  return { type: 'home', source: payload ? 'campaign' : 'direct', campaign: payload || null };
}

async function maybeSendDiscountReminder(ctx, user) {
  if (!user.referralRewardIssued || !user.referralDiscountUntil || user.referralDiscountUntil <= new Date()) return;
  const leftMs = user.referralDiscountUntil - Date.now();
  if (leftMs > 48 * 60 * 60 * 1000) return;
  const last = user.discountReminderSentAt?.getTime() || 0;
  if (Date.now() - last < 20 * 60 * 60 * 1000) return;

  user.discountReminderSentAt = new Date();
  await user.save();
  await ctx.reply(`⏳ تخفیف ${env.referralDiscountPercent}٪ تو به‌زودی منقضی می‌شود.\n\nقبل از پایان اعتبار، اشتراک VIP را با قیمت کمتر فعال کن.`, {
    reply_markup: { inline_keyboard: [[{ text: '👑 مشاهده اشتراک VIP', callback_data: 'buy_vip', style: 'primary' }]] }
  });
}

async function showAccount(ctx) {
  const user = await upsertUser(ctx.from);
  await refreshDailyUsage(user);
  await maybeSendDiscountReminder(ctx, user);

  const owner = isOwner(ctx.from.id);
  const limit = getDailyLimit(user);
  const left = owner ? 'نامحدود' : Math.max(0, limit - user.dailyUsed);
  const badge = owner ? '👑 OWNER' : user.plan === 'vip' ? '👑 VIP MEMBER' : 'کاربر رایگان';
  const quota = owner ? 'نامحدود' : `${left} از ${limit}`;
  const text = `👤 <b>حساب کاربری</b>

🏷 وضعیت: ${badge}
🎁 سهمیه امروز: ${quota}
❤️ علاقه‌مندی‌ها: ${user.favorites.length}
🎓 آموزش‌های مطالعه‌شده: ${user.lessonsRead || 0}
👥 دعوت معتبر: ${user.validReferralCount}
🎟 تخفیف رفرال: ${user.referralRewardIssued && user.referralDiscountUntil > new Date() ? 'فعال' : 'غیرفعال'}
📅 پایان VIP: ${owner ? 'دسترسی دائمی مالک' : (user.vipUntil?.toLocaleDateString('fa-IR') || 'ندارد')}

━━━━━━━━━━━━━━━
🚀 <b>Sinior Ai</b>`;
  return editOrReply(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '👑 خرید اشتراک', callback_data: 'buy_vip', style: 'primary' }],
        ...(isAdmin(ctx.from.id) ? [[{ text: '🛠 پنل ادمین', callback_data: 'open_admin' }]] : [])
      ]
    }
  });
}

async function deliverBySlug(ctx, slug, source = 'telegram', campaign = null) {
  const user = await upsertUser(ctx.from, source, campaign);
  if (user.isBlocked) return ctx.reply('دسترسی شما محدود شده است.');
  const prompt = await Prompt.findOne({ slug, isActive: true });
  if (!prompt) return ctx.reply('این پرامپت پیدا نشد.');

  await trackClick({ telegramId: user.telegramId, prompt, source, campaign });
  pendingPrompt.set(user.telegramId, { slug, source, campaign, promptId: prompt._id });

  if (!(await isJoined(ctx, user.telegramId))) {
    return ctx.reply('🔒 برای استفاده از ربات ابتدا در کانال‌های زیر عضو شو.\n\nبعد از عضویت روی «بررسی عضویت‌ها» بزن.', { reply_markup: joinButtons() });
  }

  if (!(await canReceivePrompt(user, prompt._id))) {
    return ctx.reply('🚫 سهمیه رایگان امروزت به پایان رسیده.\n\n👑 با VIP روزانه پرامپت‌های بیشتری بگیر یا با دعوت دوستان تخفیف بگیر.', {
      reply_markup: { inline_keyboard: [[{ text: '👑 خرید اشتراک', callback_data: 'buy_vip', style: 'primary' }], [{ text: '🎁 دعوت دوستان', callback_data: 'referral', style: 'success' }]] }
    });
  }

  await consumePrompt(user, prompt._id);
  await track({ telegramId: user.telegramId, promptId: prompt._id, source, campaign, event: 'delivery' });
  await validateReferral(user, ctx);
  await sendPrompt(ctx, prompt);
}

async function showVip(ctx) {
  const user = await upsertUser(ctx.from);
  const price = await calculatePrice(user, user.appliedDiscountCode);
  waitingReceipt.set(ctx.from.id, { price, sourcePromptId: null });
  const text = `👑 <b>اشتراک VIP ${env.vipDays} روزه</b>\n\n✅ روزانه ${env.vipDailyLimit} پرامپت\n✅ نشان VIP در حساب کاربری\n✅ دسترسی به امکانات ویژه آینده\n\n💰 قیمت اصلی: ${price.originalPrice.toLocaleString('fa-IR')} تومان\n🎟 تخفیف: ${price.discountAmount.toLocaleString('fa-IR')} تومان (${price.discountLabel})\n💳 مبلغ قابل پرداخت: <b>${price.finalPrice.toLocaleString('fa-IR')} تومان</b>\n\nشماره کارت: <code>${escapeHtml(env.cardNumber)}</code>\nبه نام: ${escapeHtml(env.cardHolder)}`;
  return editOrReply(ctx, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [
      [{ text: '📋 کپی مبلغ', copy_text: { text: String(price.finalPrice) }, style: 'primary' }],
      [{ text: '📋 کپی شماره کارت', copy_text: { text: env.cardNumber }, style: 'success' }],
      [{ text: '🎟 ثبت کد تخفیف', callback_data: 'apply_code' }],
      [{ text: '🧾 ارسال رسید', callback_data: 'send_receipt', style: 'primary' }],
      [{ text: '🔴 انصراف', callback_data: 'cancel_payment', style: 'danger' }]
    ] }
  });
}

async function showGallery(ctx, promptId) {
  const items = await PromptResult.find({
    promptId,
    status: 'approved',
    adminScore: { $ne: null }
  }).sort({ adminScore: -1, createdAt: -1 }).limit(3);

  if (!items.length) {
    return ctx.reply('هنوز نتیجه تأییدشده‌ای برای این پرامپت ثبت نشده. اولین نفر باش 🎨');
  }

  await ctx.reply('🏆 بهترین نتایج کاربران\n\nسه خروجی برتر بر اساس امتیاز مدیریت:');
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const medal = ['🥇', '🥈', '🥉'][index] || '🏅';
    const caption = `${medal} نتیجه برتر شماره ${index + 1}\n⭐ امتیاز مدیریت: ${item.adminScore}/10${item.caption ? `\n\n${item.caption}` : ''}`;
    if (item.fileType === 'photo') await ctx.replyWithPhoto(item.fileId, { caption });
    else if (item.fileType === 'video') await ctx.replyWithVideo(item.fileId, { caption });
    else await ctx.replyWithDocument(item.fileId, { caption });
  }
}

function registerUserHandlers(bot) {
  bot.start(async ctx => {
    const info = parseStart(ctx.startPayload || '');
    let user = await upsertUser(ctx.from, info.source, info.campaign);
    if (info.type === 'ref') user = await attachReferrer(user, info.referrerId);
    await maybeSendDiscountReminder(ctx, user);
    if (info.type === 'prompt') return deliverBySlug(ctx, info.slug, info.source, info.campaign);

    const welcomeQuota = isOwner(ctx.from.id)
      ? '👑 شما مالک ربات هستید و به تمام امکانات بدون محدودیت دسترسی دارید.'
      : `🎁 امروز ${env.freeDailyLimit} پرامپت رایگان در اختیارت قرار داره.`;

    await ctx.reply(
      `👋 سلام ${ctx.from.first_name || ''}، خوش اومدی.\n\nبه Sinior Ai خوش اومدی؛ مرجع آموزش و پرامپت‌های هوش مصنوعی.\n\n${welcomeQuota}\n\nیکی از گزینه‌های زیر رو انتخاب کن.`,
      { reply_markup: mainMenu(ctx.from.id) }
    );
  });

  bot.action('check_join', async ctx => {
    await ctx.answerCbQuery();
    if (!(await isJoined(ctx, ctx.from.id))) return ctx.reply('هنوز عضویت در همه کانال‌ها کامل نشده است.');
    const pending = pendingPrompt.get(ctx.from.id);
    if (pending) return deliverBySlug(ctx, pending.slug, pending.source, pending.campaign);
    return ctx.reply('✅ عضویت تأیید شد.', { reply_markup: mainMenu(ctx.from.id) });
  });

  bot.hears('👤 حساب من', showAccount);
  bot.action('my_account', async ctx => { await ctx.answerCbQuery(); return showAccount(ctx); });
  bot.hears('👑 خرید اشتراک', showVip);
  bot.action('buy_vip', async ctx => { await ctx.answerCbQuery(); return showVip(ctx); });
  bot.hears('🎓 آموزش هوش مصنوعی', sendDailyLesson);
  bot.hears('📝 درخواست پرامپت', ctx => {
    setInputState(ctx.from.id, 'awaiting_prompt_request');
    return ctx.reply(
      '📝 موضوع پرامپتی که نیاز داری را دقیق بنویس.\n\nمثال: «پرامپت ساخت ویدیوی سینمایی از یک ماشین در شب بارانی»\n\nدرخواستت برای بررسی ثبت می‌شود.',
      { reply_markup: cancelKeyboard() }
    );
  });

  bot.hears('🎁 دعوت دوستان', async ctx => {
    const user = await upsertUser(ctx.from);
    const link = `https://t.me/${env.botUsername}?start=ref_${user.telegramId}`;
    return ctx.reply(`🎁 <b>دوستانت را دعوت کن و تخفیف بگیر</b>\n\nبا ثبت ${env.referralRequired} دعوت معتبر، ${env.referralDiscountPercent}٪ تخفیف خرید VIP می‌گیری.\n\nدعوت‌های معتبر تو: ${user.validReferralCount} از ${env.referralRequired}\n\nلینک اختصاصی:\n${link}\n\n🎉 منتظر کمپین‌ها و تخفیف‌های بعدی هم باش.`, { parse_mode: 'HTML' });
  });
  bot.action('referral', async ctx => { await ctx.answerCbQuery(); ctx.message = undefined; const user = await upsertUser(ctx.from); const link = `https://t.me/${env.botUsername}?start=ref_${user.telegramId}`; return editOrReply(ctx, `🎁 دوستانت را دعوت کن و تخفیف بگیر\n\n${env.referralRequired} دعوت معتبر = ${env.referralDiscountPercent}٪ تخفیف VIP\n\nدعوت‌های معتبر: ${user.validReferralCount} از ${env.referralRequired}\n\n${link}\n\n🎉 منتظر کمپین‌ها و تخفیف‌های بعدی هم باش.`); });

  bot.hears('📞 پشتیبانی', ctx => ctx.reply(`برای پشتیبانی با @${env.supportUsername} در ارتباط باش.`));
  bot.hears('🛠 پنل ادمین', async ctx => {
    if (!isAdmin(ctx.from.id)) return;
    return ctx.reply('🛠 پنل ادمین', { reply_markup: { inline_keyboard: [[{ text: 'باز کردن پنل', callback_data: 'open_admin' }]] } });
  });

  bot.action(/^fav_(.+)$/, async ctx => {
    const prompt = await Prompt.findById(ctx.match[1]);
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!prompt || !user) return ctx.answerCbQuery('پرامپت یا کاربر پیدا نشد.', { show_alert: true });

    const index = user.favorites.findIndex(id => String(id) === String(prompt._id));
    const exists = index >= 0;
    if (exists) {
      user.favorites.splice(index, 1);
      await Prompt.updateOne({ _id: prompt._id, favoriteCount: { $gt: 0 } }, { $inc: { favoriteCount: -1 } });
    } else {
      user.favorites.push(prompt._id);
      await Prompt.updateOne({ _id: prompt._id }, { $inc: { favoriteCount: 1 } });
    }
    await user.save();

    await ctx.answerCbQuery(exists ? 'از علاقه‌مندی‌ها حذف شد.' : 'به علاقه‌مندی‌ها اضافه شد ⭐');
    try {
      await ctx.editMessageReplyMarkup(promptButtons(prompt, !exists));
    } catch (_) {}
  });

  bot.hears('❤️ علاقه‌مندی‌ها', async ctx => {
    const user = await User.findOne({ telegramId: ctx.from.id }).populate('favorites');
    const items = (user?.favorites || []).filter(p => p?.isActive).slice(-20);
    if (!items.length) return ctx.reply('هنوز پرامپتی ذخیره نکردی.');
    return ctx.reply('❤️ علاقه‌مندی‌های تو', { reply_markup: { inline_keyboard: items.map(p => [{ text: p.title, callback_data: `openfav_${p._id}` }]) } });
  });
  bot.action(/^openfav_(.+)$/, async ctx => { await ctx.answerCbQuery(); const prompt = await Prompt.findById(ctx.match[1]); if (prompt) return sendPrompt(ctx, prompt); });

  bot.action(/^rate_(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const id = ctx.match[1];
    return ctx.reply('از ۱ تا ۵ چه امتیازی به این پرامپت می‌دی؟', { reply_markup: { inline_keyboard: [[1,2,3,4,5].map(n => ({ text: `${n}⭐`, callback_data: `rateval_${id}_${n}` }))] } });
  });
  bot.action(/^rateval_(.+)_([1-5])$/, async ctx => {
    await ctx.answerCbQuery();
    const promptId = ctx.match[1];
    const rating = Number(ctx.match[2]);
    const old = await PromptRating.findOne({ userTelegramId: ctx.from.id, promptId });
    if (old) {
      const diff = rating - old.rating;
      old.rating = rating;
      await old.save();
      await Prompt.updateOne({ _id: promptId }, { $inc: { ratingSum: diff } });
    } else {
      await PromptRating.create({ userTelegramId: ctx.from.id, promptId, rating });
      await Prompt.updateOne({ _id: promptId }, { $inc: { ratingSum: rating, ratingCount: 1 } });
    }
    return ctx.reply(`✅ امتیاز ${rating} از ۵ ثبت شد. ممنون از بازخوردت 💜`);
  });

  bot.action(/^result_(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    setInputState(ctx.from.id, 'awaiting_prompt_result', { promptId: ctx.match[1] });
    return ctx.reply(
      '🎨 نتیجه‌ای که با این پرامپت ساختی را به‌صورت عکس، ویدیو یا فایل بفرست.\n\nبعد از بررسی مدیریت و امتیازدهی، در صورت تأیید می‌تواند وارد بخش بهترین نتایج شود.',
      { reply_markup: cancelKeyboard() }
    );
  });
  bot.action(/^gallery_(.+)$/, async ctx => { await ctx.answerCbQuery(); return showGallery(ctx, ctx.match[1]); });

  bot.action('apply_code', async ctx => {
    await ctx.answerCbQuery();
    setInputState(ctx.from.id, 'awaiting_discount_code');
    return ctx.reply('🎟 کد تخفیف را ارسال کن.', { reply_markup: cancelKeyboard() });
  });

  bot.action('send_receipt', async ctx => {
    await ctx.answerCbQuery();
    const draft = waitingReceipt.get(ctx.from.id);
    if (!draft) {
      await showVip(ctx);
      return ctx.reply('اطلاعات پرداخت دوباره آماده شد. حالا روی «ارسال رسید» بزن.');
    }
    setInputState(ctx.from.id, 'awaiting_receipt');
    return ctx.reply(
      '🧾 حالا تصویر رسید پرداخت را ارسال کن.\n\nفقط تصویر بعدی به‌عنوان رسید پرداخت ثبت می‌شود.',
      { reply_markup: cancelKeyboard() }
    );
  });

  bot.action('cancel_input', async ctx => {
    await ctx.answerCbQuery('عملیات لغو شد.');
    clearInputState(ctx.from.id);
    return editOrReply(ctx, '❌ عملیات لغو شد.');
  });

  bot.action('cancel_payment', async ctx => {
    await ctx.answerCbQuery();
    clearInputState(ctx.from.id);
    waitingReceipt.delete(ctx.from.id);
    return editOrReply(ctx, 'پرداخت لغو شد.');
  });

  bot.on('message', async (ctx, next) => {
    if (!ctx.from || ctx.chat?.type !== 'private') return next();

    const state = inputState.get(ctx.from.id);
    if (!state) return next();

    if (state.type === 'awaiting_prompt_request') {
      if (!ctx.message.text) {
        return ctx.reply('لطفاً درخواستت را به‌صورت متن بفرست یا عملیات را لغو کن.', {
          reply_markup: cancelKeyboard()
        });
      }

      clearInputState(ctx.from.id);
      const request = await PromptRequest.create({
        userTelegramId: ctx.from.id,
        text: ctx.message.text.trim()
      });
      await notifyPromptRequest(ctx, request, ctx.from);
      await reactToMessage(ctx, '❤️');
      return ctx.reply('✅ درخواستت ثبت شد.\n\nاگر این موضوع به پرامپت جدید تبدیل شود، از همین ربات بهت اطلاع می‌دهیم.');
    }

    if (state.type === 'awaiting_prompt_result') {
      if (!(ctx.message.photo || ctx.message.video || ctx.message.document)) {
        return ctx.reply('لطفاً نتیجه را به‌صورت عکس، ویدیو یا فایل بفرست یا عملیات را لغو کن.', {
          reply_markup: cancelKeyboard()
        });
      }

      let fileId;
      let fileType;
      if (ctx.message.photo) {
        fileId = ctx.message.photo.at(-1).file_id;
        fileType = 'photo';
      } else if (ctx.message.video) {
        fileId = ctx.message.video.file_id;
        fileType = 'video';
      } else {
        fileId = ctx.message.document.file_id;
        fileType = 'document';
      }

      const promptId = state.data.promptId;
      clearInputState(ctx.from.id);

      const result = await PromptResult.create({
        userTelegramId: ctx.from.id,
        promptId,
        fileId,
        fileType,
        caption: ctx.message.caption || ''
      });
      const prompt = await Prompt.findById(promptId);
      await notifyPromptResult(ctx, result, prompt, ctx.from);
      await reactToMessage(ctx, '🔥');
      return ctx.reply('✅ نتیجه‌ات دریافت شد.\n\nبعد از بررسی و امتیازدهی مدیریت، در صورت تأیید می‌تواند در بخش بهترین نتایج نمایش داده شود.');
    }

    if (state.type === 'awaiting_discount_code') {
      if (!ctx.message.text) {
        return ctx.reply('لطفاً کد تخفیف را به‌صورت متن بفرست یا عملیات را لغو کن.', {
          reply_markup: cancelKeyboard()
        });
      }

      const user = await User.findOne({ telegramId: ctx.from.id });
      try {
        user.appliedDiscountCode = ctx.message.text.trim().toUpperCase();
        await user.save();
        await calculatePrice(user, user.appliedDiscountCode);
        clearInputState(ctx.from.id);
        await ctx.reply('🎉 کد تخفیف با موفقیت اعمال شد.');
        return showVip(ctx);
      } catch (error) {
        user.appliedDiscountCode = null;
        await user.save();
        return ctx.reply(`❌ ${error.message}\n\nیک کد دیگر بفرست یا عملیات را لغو کن.`, {
          reply_markup: cancelKeyboard()
        });
      }
    }

    if (state.type === 'awaiting_receipt') {
      if (!ctx.message.photo) {
        return ctx.reply('لطفاً رسید پرداخت را به‌صورت تصویر بفرست یا عملیات را لغو کن.', {
          reply_markup: cancelKeyboard()
        });
      }

      const data = waitingReceipt.get(ctx.from.id);
      if (!data) {
        clearInputState(ctx.from.id);
        return ctx.reply('اطلاعات پرداخت پیدا نشد. لطفاً دوباره از بخش خرید اشتراک شروع کن.');
      }

      const fileId = ctx.message.photo.at(-1).file_id;
      const payment = await Payment.create({
        userTelegramId: ctx.from.id,
        receiptFileId: fileId,
        originalPrice: data.price.originalPrice,
        discountAmount: data.price.discountAmount,
        finalPrice: data.price.finalPrice,
        discountSource: data.price.discountSource,
        discountCode: data.price.discountCode,
        sourcePromptId: data.sourcePromptId
      });
      payment.paymentCode = makePaymentCode(payment._id);
      await payment.save();

      clearInputState(ctx.from.id);
      waitingReceipt.delete(ctx.from.id);
      await reactToMessage(ctx, '👀');
      await notifyPayment(ctx, payment, ctx.from);
      return ctx.reply('⏳ رسید پرداختت دریافت شد.\n\nبعد از بررسی مدیریت، نتیجه از همین ربات بهت اعلام می‌شود.');
    }

    clearInputState(ctx.from.id);
    return next();
  });
}

module.exports = { registerUserHandlers };
