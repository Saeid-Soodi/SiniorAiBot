const Prompt = require('../models/Prompt');
const User = require('../models/User');
const Payment = require('../models/Payment');
const PromptRequest = require('../models/PromptRequest');
const PromptResult = require('../models/PromptResult');
const AiLesson = require('../models/AiLesson');
const DiscountCode = require('../models/DiscountCode');
const Admin = require('../models/Admin');
const SupportTicket = require('../models/SupportTicket');
const WalletTransaction = require('../models/WalletTransaction');
const ChannelPost = require('../models/ChannelPost');
const ClickEvent = require('../models/ClickEvent');
const PromptRating = require('../models/PromptRating');
const GiftCode = require('../models/GiftCode');
const env = require('../config/env');
const { setState, getState, clearState } = require('../services/stateManager');
const { isOwner, isAdmin, can } = require('../services/adminService');
const { activateOrExtendVip } = require('../services/subscriptionService');
const { creditWallet } = require('../services/walletService');
const { createGift } = require('../services/giftService');
const { consumeCode } = require('../services/discountService');
const { audit } = require('../services/auditService');
const { paginationRow } = require('../utils/pagination');
const { formatToman, formatDateTime } = require('../utils/format');
const escapeHtml = require('../utils/html');
const { promptSkipKeyboard } = require('../keyboards/main');
const { publishChannelPayload, publishStoredChannelPost } = require('../services/channelPostService');
const { parseOffsetMinutes, parseScheduleInput, formatScheduledAt } = require('../utils/schedule');

const PAGE_SIZE = 8;
const adminBack = [[{ text: '🔙 بازگشت', callback_data: 'admin_home' }, { text: '🏠 منوی اصلی پنل', callback_data: 'admin_home' }]];

async function guard(ctx, permission = null) {
  if (!(await isAdmin(ctx.from.id))) { await ctx.answerCbQuery?.('دسترسی ندارید.', { show_alert: true }).catch(() => {}); return false; }
  if (permission && !(await can(ctx.from.id, permission))) { await ctx.answerCbQuery?.('مجوز این بخش را ندارید.', { show_alert: true }).catch(() => {}); return false; }
  return true;
}

function ownerGuard(ctx) {
  if (isOwner(ctx.from.id)) return true;
  ctx.answerCbQuery?.('حذف دائم فقط برای مالک ربات مجاز است.', { show_alert: true }).catch(() => {});
  return false;
}

function permanentDeleteWarning(entityName, label) {
  return `☠️ <b>حذف دائم ${entityName}</b>

${label}

⚠️ این عملیات قابل‌بازیابی نیست و رکورد واقعاً از MongoDB حذف می‌شود.

برای ادامه باید دوباره تأیید کنی.`;
}

function adminMenu() {
  return { inline_keyboard: [
    [{ text: '➕ افزودن پرامپت', callback_data: 'a_prompt_add' }, { text: '📚 مدیریت پرامپت‌ها', callback_data: 'a_prompts_1' }],
    [{ text: '🎓 آموزش‌ها', callback_data: 'a_lessons_1' }, { text: '📝 درخواست‌ها', callback_data: 'a_requests_1' }],
    [{ text: '💳 پرداخت‌ها', callback_data: 'a_payments_1' }, { text: '👥 کاربران', callback_data: 'a_users_1' }],
    [{ text: '🎟 کدهای تخفیف', callback_data: 'a_codes_1' }, { text: '📢 پیام همگانی', callback_data: 'a_broadcast' }],
    [{ text: '📣 ارسال پست کانال', callback_data: 'a_channel_post' }, { text: '🕒 پست‌های زمان‌بندی‌شده', callback_data: 'a_scheduled_1' }],
    [{ text: '🛡 مدیریت ادمین‌ها', callback_data: 'a_admins' }]
  ] };
}

async function showAdmin(ctx) {
  if (!(await guard(ctx))) return;
  const text = '🛠 <b>پنل مدیریت Sinior Ai</b>\n\nبخش موردنظر را انتخاب کن.';
  if (ctx.callbackQuery) { await ctx.answerCbQuery().catch(() => {}); return ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: adminMenu() }).catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: adminMenu() })); }
  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: adminMenu() });
}

function promptPreview(data) {
  return `👁 <b>پیش‌نمایش پرامپت</b>\n\nعنوان: ${escapeHtml(data.title || '-')}\nاسلاگ: <code>${escapeHtml(data.slug || '-')}</code>\nابزارها: ${escapeHtml((data.tools || []).join('، ') || '-')}\nنکته: ${escapeHtml(data.usageTip || 'ندارد')}\nلینک پست: ${escapeHtml(data.channelPostUrl || 'ندارد')}\nعکس: ${data.imageFileId ? 'دارد' : 'ندارد'}\n\n<pre>${escapeHtml(data.promptText || '')}</pre>`;
}


function validButtonUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:', 'tg:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function channelReplyMarkup(data) {
  const rows = Array.isArray(data.buttonRows) ? data.buttonRows : [];
  return rows.length ? { inline_keyboard: rows } : undefined;
}

function channelBuilderKeyboard(data) {
  const count = (data.buttonRows || []).flat().length;
  return {
    inline_keyboard: [
      [{ text: '➕ افزودن دکمه لینک‌دار', callback_data: 'channel_button_add', style: 'success' }],
      [{ text: '🤖 انتخاب پرامپت از ربات', callback_data: 'channel_prompt_page_1' }],
      ...(count ? [[{ text: `🧩 مدیریت دکمه‌ها (${count})`, callback_data: 'channel_buttons_manage' }]] : []),
      [{ text: '👁 پیش‌نمایش نهایی', callback_data: 'channel_preview' }],
      [{ text: '❌ لغو', callback_data: 'cancel_input', style: 'danger' }],
      adminBack[0]
    ]
  };
}

function addChannelButton(data, button, placement = 'new') {
  data.buttonRows ||= [];
  const total = data.buttonRows.flat().length;
  if (total >= 8) throw new Error('حداکثر ۸ دکمه برای هر پست مجاز است.');
  if (placement === 'same' && data.buttonRows.length && data.buttonRows.at(-1).length < 2) {
    data.buttonRows.at(-1).push(button);
  } else {
    data.buttonRows.push([button]);
  }
}

async function sendChannelPreview(ctx, data) {
  const extra = { parse_mode: 'HTML' };
  const replyMarkup = channelReplyMarkup(data);
  if (data.type === 'album') {
    const ids = (data.mediaFileIds || []).slice(0, 10);
    const media = ids.map((fileId, index) => ({
      type: 'photo',
      media: fileId,
      ...(index === 0 ? { caption: data.caption, parse_mode: 'HTML' } : {})
    }));
    await ctx.replyWithMediaGroup(media);
    if (replyMarkup) {
      return ctx.reply('🔗 <b>پیش‌نمایش دکمه‌های مرتبط</b>', { parse_mode: 'HTML', reply_markup: replyMarkup });
    }
    return;
  }
  if (replyMarkup) extra.reply_markup = replyMarkup;
  if (data.type === 'photo') return ctx.replyWithPhoto(data.fileId, { caption: data.caption, ...extra });
  if (data.type === 'video') return ctx.replyWithVideo(data.fileId, { caption: data.caption, ...extra });
  return ctx.reply(data.caption, extra);
}

function scheduleOffsetMinutes() {
  return parseOffsetMinutes(env.scheduleUtcOffset);
}

function scheduledPostKeyboard(post) {
  return { inline_keyboard: [
    [{ text: '🚀 انتشار فوری', callback_data: `scheduled_publish_${post._id}`, style: 'success' }],
    [{ text: '🕒 تغییر زمان', callback_data: `scheduled_reschedule_${post._id}` }],
    [{ text: '❌ لغو زمان‌بندی', callback_data: `scheduled_cancel_${post._id}`, style: 'danger' }],
    [{ text: '🔙 بازگشت', callback_data: 'a_scheduled_1' }],
    adminBack[0]
  ] };
}

async function listGeneric(ctx, Model, query, page, prefix, render, permission) {
  if (!(await guard(ctx, permission))) return;
  const total = await Model.countDocuments(query); const pages = Math.max(1, Math.ceil(total / PAGE_SIZE)); const p = Math.min(Math.max(page, 1), pages);
  const items = await Model.find(query).sort({ createdAt: -1 }).skip((p - 1) * PAGE_SIZE).limit(PAGE_SIZE);
  const rows = items.map(render); rows.push(paginationRow(p, pages, prefix)); rows.push(adminBack[0]);
  await ctx.answerCbQuery().catch(() => {}); return ctx.editMessageText(`📋 تعداد: ${total}`, { reply_markup: { inline_keyboard: rows } }).catch(() => ctx.reply(`📋 تعداد: ${total}`, { reply_markup: { inline_keyboard: rows } }));
}

function registerAdminHandlers(bot) {
  bot.command('admin', showAdmin); bot.hears('🛠 پنل ادمین', showAdmin); bot.action('open_admin', showAdmin); bot.action('admin_home', showAdmin);

  bot.action('a_prompt_add', async ctx => {
    if (!(await guard(ctx, 'prompts'))) return;
    await ctx.answerCbQuery();
    setState(ctx.from.id, 'admin_prompt', { step: 'title', data: {} });
    return ctx.reply('➕ <b>افزودن پرامپت</b>\n\nعنوان نمایشی را بفرست.\nمثال: دختر تابستانی در ساحل', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: adminBack }
    });
  });

  bot.action(/^a_prompts_(\d+)$/, async ctx => {
    if (!(await guard(ctx, 'prompts'))) return;
    const page = Number(ctx.match[1]);
    const query = { isDeleted: { $ne: true } };
    const total = await Prompt.countDocuments(query);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(Math.max(page, 1), pages);
    const items = await Prompt.find(query).sort({ createdAt: -1 }).skip((current - 1) * PAGE_SIZE).limit(PAGE_SIZE);
    const rows = [
      [{ text: '➕ افزودن پرامپت', callback_data: 'a_prompt_add', style: 'success' }],
      ...items.map(item => [{ text: `${item.isActive ? '✨' : '⏸'} ${item.title}`, callback_data: `a_prompt_${item._id}` }]),
      paginationRow(current, pages, 'a_prompts'),
      [{ text: '🗑 پرامپت‌های حذف‌شده', callback_data: 'a_prompts_deleted_1' }],
      adminBack[0]
    ];
    await ctx.answerCbQuery().catch(() => {});
    return ctx.editMessageText(`📚 <b>مدیریت پرامپت‌ها</b>\n\nتعداد: ${total}`, {
      parse_mode: 'HTML', reply_markup: { inline_keyboard: rows }
    }).catch(() => ctx.reply(`📚 مدیریت پرامپت‌ها | ${total} مورد`, { reply_markup: { inline_keyboard: rows } }));
  });

  bot.action(/^a_prompt_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'prompts'))) return;
    const prompt = await Prompt.findOne({ _id: ctx.match[1], isDeleted: { $ne: true } });
    if (!prompt) return ctx.answerCbQuery('پرامپت پیدا نشد یا حذف شده است.', { show_alert: true });
    await ctx.answerCbQuery();
    const keyboard = {
      inline_keyboard: [
        [{ text: '✏️ ویرایش', callback_data: `a_prompt_edit_${prompt._id}` }, { text: '🗑 حذف', callback_data: `a_prompt_delete_${prompt._id}`, style: 'danger' }],
        [{ text: '🔗 لینک دریافت', url: `https://t.me/${env.botUsername}?start=prompt_${prompt.slug}` }],
        [{ text: '🔙 بازگشت به پرامپت‌ها', callback_data: 'a_prompts_1' }, { text: '🏠 منوی اصلی پنل', callback_data: 'admin_home' }]
      ]
    };
    return ctx.editMessageText(promptPreview(prompt), { parse_mode: 'HTML', reply_markup: keyboard })
      .catch(() => ctx.reply(promptPreview(prompt), { parse_mode: 'HTML', reply_markup: keyboard }));
  });

  bot.action(/^a_prompt_edit_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'prompts'))) return;
    const prompt = await Prompt.findOne({ _id: ctx.match[1], isDeleted: { $ne: true } });
    if (!prompt) return ctx.answerCbQuery('پرامپت پیدا نشد.', { show_alert: true });
    await ctx.answerCbQuery();
    setState(ctx.from.id, 'admin_prompt', { step: 'title', mode: 'edit', promptId: prompt._id, data: prompt.toObject() });
    return ctx.reply('✏️ ویرایش شروع شد.\n\nعنوان جدید را بفرست یا «همان» بنویس تا مقدار فعلی حفظ شود.', {
      reply_markup: { inline_keyboard: [[{ text: '❌ لغو عملیات', callback_data: 'cancel_input', style: 'danger' }], [{ text: '🔙 بازگشت به پرامپت‌ها', callback_data: 'a_prompts_1' }]] }
    });
  });

  bot.action(/^a_prompt_delete_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'prompts'))) return;
    const prompt = await Prompt.findOne({ _id: ctx.match[1], isDeleted: { $ne: true } });
    if (!prompt) return ctx.answerCbQuery('پرامپت پیدا نشد.', { show_alert: true });
    await ctx.answerCbQuery();
    return ctx.editMessageText(
      `🗑 <b>حذف پرامپت</b>\n\nعنوان: ${escapeHtml(prompt.title)}\nاسلاگ: <code>${escapeHtml(prompt.slug)}</code>\n\nپرامپت از دسترس کاربران خارج می‌شود، اما برای بازیابی در آرشیو باقی می‌ماند.\n\nاز حذف مطمئنی؟`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '✅ بله، حذف شود', callback_data: `a_prompt_delete_confirm_${prompt._id}`, style: 'danger' }], [{ text: '❌ انصراف', callback_data: `a_prompt_${prompt._id}` }]] } }
    );
  });

  bot.action(/^a_prompt_delete_confirm_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'prompts'))) return;
    const prompt = await Prompt.findOneAndUpdate(
      { _id: ctx.match[1], isDeleted: { $ne: true } },
      { isDeleted: true, isActive: false, deletedAt: new Date(), deletedBy: ctx.from.id },
      { new: true }
    );
    if (!prompt) return ctx.answerCbQuery('پرامپت قبلاً حذف شده یا پیدا نشد.', { show_alert: true });
    await audit(ctx.from.id, 'prompt_soft_delete', 'Prompt', prompt._id);
    await ctx.answerCbQuery('پرامپت حذف شد.');
    return ctx.editMessageText('✅ پرامپت حذف شد و به آرشیو منتقل شد.', {
      reply_markup: { inline_keyboard: [[{ text: '📚 بازگشت به مدیریت پرامپت‌ها', callback_data: 'a_prompts_1' }], [{ text: '🏠 منوی اصلی پنل', callback_data: 'admin_home' }]] }
    });
  });

  bot.action(/^a_prompts_deleted_(\d+)$/, async ctx => {
    if (!(await guard(ctx, 'prompts'))) return;
    const page = Number(ctx.match[1]);
    const query = { isDeleted: true };
    const total = await Prompt.countDocuments(query);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(Math.max(page, 1), pages);
    const items = await Prompt.find(query).sort({ deletedAt: -1, createdAt: -1 }).skip((current - 1) * PAGE_SIZE).limit(PAGE_SIZE);
    const rows = items.map(item => [
      { text: `♻️ ${item.title}`, callback_data: `a_prompt_restore_${item._id}` },
      { text: '☠️ حذف دائم', callback_data: `a_prompt_purge_${item._id}`, style: 'danger' }
    ]);
    rows.push(paginationRow(current, pages, 'a_prompts_deleted'));
    rows.push([{ text: '🔙 بازگشت به پرامپت‌ها', callback_data: 'a_prompts_1' }]);
    await ctx.answerCbQuery().catch(() => {});
    return ctx.editMessageText(`🗑 <b>پرامپت‌های حذف‌شده</b>\n\nتعداد: ${total}\nبرای بازیابی روی هر مورد بزن.`, {
      parse_mode: 'HTML', reply_markup: { inline_keyboard: rows }
    }).catch(() => ctx.reply(`🗑 پرامپت‌های حذف‌شده | ${total} مورد`, { reply_markup: { inline_keyboard: rows } }));
  });

  bot.action(/^a_prompt_restore_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'prompts'))) return;
    const prompt = await Prompt.findOneAndUpdate(
      { _id: ctx.match[1], isDeleted: true },
      { isDeleted: false, isActive: true, deletedAt: null, deletedBy: null },
      { new: true }
    );
    if (!prompt) return ctx.answerCbQuery('پرامپت حذف‌شده پیدا نشد.', { show_alert: true });
    await audit(ctx.from.id, 'prompt_restore', 'Prompt', prompt._id);
    await ctx.answerCbQuery('بازیابی شد.');
    return ctx.editMessageText(`✅ «${escapeHtml(prompt.title)}» بازیابی و فعال شد.`, {
      parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '📚 مدیریت پرامپت‌ها', callback_data: 'a_prompts_1' }], [{ text: '🗑 آرشیو حذف‌شده‌ها', callback_data: 'a_prompts_deleted_1' }]] }
    });
  });


  bot.action(/^a_prompt_purge_([a-f0-9]{24})$/, async ctx => {
    if (!ownerGuard(ctx)) return;
    const prompt = await Prompt.findOne({ _id: ctx.match[1], isDeleted: true });
    if (!prompt) return ctx.answerCbQuery('پرامپت باید ابتدا در آرشیو باشد.', { show_alert: true });
    await ctx.answerCbQuery();
    return ctx.editMessageText(permanentDeleteWarning('پرامپت', `عنوان: ${escapeHtml(prompt.title)}
اسلاگ: <code>${escapeHtml(prompt.slug)}</code>

با حذف دائم، اسلاگ دوباره آزاد می‌شود.`), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [
        [{ text: '☠️ بله، برای همیشه حذف شود', callback_data: `a_prompt_purge_confirm_${prompt._id}`, style: 'danger' }],
        [{ text: '❌ انصراف', callback_data: 'a_prompts_deleted_1' }]
      ] }
    });
  });

  bot.action(/^a_prompt_purge_confirm_([a-f0-9]{24})$/, async ctx => {
    if (!ownerGuard(ctx)) return;
    const prompt = await Prompt.findOne({ _id: ctx.match[1], isDeleted: true });
    if (!prompt) return ctx.answerCbQuery('پرامپت پیدا نشد یا قبلاً حذف دائم شده است.', { show_alert: true });
    const id = prompt._id;
    await Promise.all([
      PromptRating.deleteMany({ promptId: id }),
      PromptResult.deleteMany({ promptId: id }),
      ClickEvent.deleteMany({ promptId: id }),
      User.updateMany({}, { $pull: { favorites: id, receivedPrompts: id } }),
      Payment.updateMany({ sourcePromptId: id }, { $set: { sourcePromptId: null } })
    ]);
    await Prompt.deleteOne({ _id: id });
    await audit(ctx.from.id, 'prompt_permanent_delete', 'Prompt', id, { slug: prompt.slug });
    await ctx.answerCbQuery('پرامپت برای همیشه حذف شد.');
    return ctx.editMessageText(`✅ پرامپت «${escapeHtml(prompt.title)}» برای همیشه از دیتابیس حذف شد.

اسلاگ <code>${escapeHtml(prompt.slug)}</code> دوباره قابل استفاده است.`, {
      parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🗑 بازگشت به آرشیو', callback_data: 'a_prompts_deleted_1' }], adminBack[0]] }
    });
  });

  bot.action(/^a_lessons_(\d+)$/, async ctx => {
    if (!(await guard(ctx, 'lessons'))) return;
    const requestedPage = Number(ctx.match[1]);
    const query = { isDeleted: { $ne: true } };
    const total = await AiLesson.countDocuments(query);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(requestedPage, 1), pages);
    const items = await AiLesson.find(query).sort({ order: 1, createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE);
    const rows = [
      [{ text: '➕ افزودن آموزش', callback_data: 'a_lesson_add', style: 'success' }],
      ...items.map(l => [{ text: `${l.isActive ? '🎓' : '⏸'} ${l.title}`, callback_data: `a_lesson_${l._id}` }]),
      [{ text: '🗑 آموزش‌های حذف‌شده', callback_data: 'a_lessons_deleted_1' }],
      paginationRow(page, pages, 'a_lessons'),
      adminBack[0]
    ];
    await ctx.answerCbQuery().catch(() => {});
    return ctx.editMessageText(`🎓 مدیریت آموزش‌ها | ${total} مورد`, { reply_markup: { inline_keyboard: rows } })
      .catch(() => ctx.reply('🎓 مدیریت آموزش‌ها', { reply_markup: { inline_keyboard: rows } }));
  });

  bot.action(/^a_lesson_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'lessons'))) return;
    const lesson = await AiLesson.findOne({ _id: ctx.match[1], isDeleted: { $ne: true } });
    if (!lesson) return ctx.answerCbQuery('آموزش پیدا نشد.', { show_alert: true });
    await ctx.answerCbQuery();
    return ctx.editMessageText(`🎓 <b>${escapeHtml(lesson.title)}</b>\n\n${escapeHtml(lesson.content)}\n\nوضعیت: ${lesson.isActive ? 'فعال' : 'غیرفعال'}`, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [
        [{ text: '✏️ ویرایش', callback_data: `a_lesson_edit_${lesson._id}` }, { text: '🗑 حذف', callback_data: `a_lesson_delete_${lesson._id}`, style: 'danger' }],
        [{ text: '🎓 بازگشت به آموزش‌ها', callback_data: 'a_lessons_1' }],
        adminBack[0]
      ] }
    });
  });

  bot.action(/^a_lesson_edit_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'lessons'))) return;
    const lesson = await AiLesson.findOne({ _id: ctx.match[1], isDeleted: { $ne: true } });
    if (!lesson) return ctx.answerCbQuery('آموزش پیدا نشد.', { show_alert: true });
    setState(ctx.from.id, 'admin_lesson', { step: 'title', mode: 'edit', id: lesson._id, data: lesson.toObject() });
    await ctx.answerCbQuery();
    return ctx.reply('عنوان جدید را بفرست یا «همان» بنویس.');
  });

  bot.action(/^a_lesson_delete_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'lessons'))) return;
    const lesson = await AiLesson.findOne({ _id: ctx.match[1], isDeleted: { $ne: true } });
    if (!lesson) return ctx.answerCbQuery('آموزش پیدا نشد.', { show_alert: true });
    await ctx.answerCbQuery();
    return ctx.editMessageText(
      `🗑 <b>حذف آموزش</b>\n\nعنوان: ${escapeHtml(lesson.title)}\n\nآموزش از دسترس کاربران خارج می‌شود، اما برای بازیابی در آرشیو باقی می‌ماند.\n\nاز حذف مطمئنی؟`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
        [{ text: '✅ بله، حذف شود', callback_data: `a_lesson_delete_confirm_${lesson._id}`, style: 'danger' }],
        [{ text: '❌ انصراف', callback_data: `a_lesson_${lesson._id}` }],
        [{ text: '🎓 بازگشت به آموزش‌ها', callback_data: 'a_lessons_1' }]
      ] } }
    );
  });

  bot.action(/^a_lesson_delete_confirm_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'lessons'))) return;
    const lesson = await AiLesson.findOneAndUpdate(
      { _id: ctx.match[1], isDeleted: { $ne: true } },
      { isDeleted: true, isActive: false, deletedAt: new Date(), deletedBy: ctx.from.id },
      { new: true }
    );
    if (!lesson) return ctx.answerCbQuery('آموزش قبلاً حذف شده یا پیدا نشد.', { show_alert: true });
    await audit(ctx.from.id, 'lesson_soft_delete', 'AiLesson', lesson._id);
    await ctx.answerCbQuery('آموزش حذف شد.');
    return ctx.editMessageText('✅ آموزش حذف شد و به آرشیو منتقل شد.', { reply_markup: { inline_keyboard: [
      [{ text: '🎓 بازگشت به مدیریت آموزش‌ها', callback_data: 'a_lessons_1' }],
      [{ text: '🗑 مشاهده آرشیو', callback_data: 'a_lessons_deleted_1' }],
      [{ text: '🏠 منوی اصلی پنل', callback_data: 'admin_home' }]
    ] } });
  });

  bot.action(/^a_lessons_deleted_(\d+)$/, async ctx => {
    if (!(await guard(ctx, 'lessons'))) return;
    const requestedPage = Number(ctx.match[1]);
    const query = { isDeleted: true };
    const total = await AiLesson.countDocuments(query);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(requestedPage, 1), pages);
    const items = await AiLesson.find(query).sort({ deletedAt: -1, createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE);
    const rows = [
      ...items.map(l => [{ text: `♻️ ${l.title}`, callback_data: `a_lesson_restore_${l._id}` }, { text: '☠️ حذف دائم', callback_data: `a_lesson_purge_${l._id}`, style: 'danger' }]),
      paginationRow(page, pages, 'a_lessons_deleted'),
      [{ text: '🔙 بازگشت به آموزش‌های فعال', callback_data: 'a_lessons_1' }],
      adminBack[0]
    ];
    await ctx.answerCbQuery().catch(() => {});
    return ctx.editMessageText(`🗑 <b>آموزش‌های حذف‌شده</b>\n\nتعداد: ${total}\nبرای بازیابی روی هر مورد بزن.`, {
      parse_mode: 'HTML', reply_markup: { inline_keyboard: rows }
    }).catch(() => ctx.reply(`🗑 آموزش‌های حذف‌شده | ${total} مورد`, { reply_markup: { inline_keyboard: rows } }));
  });

  bot.action(/^a_lesson_restore_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'lessons'))) return;
    const lesson = await AiLesson.findOneAndUpdate(
      { _id: ctx.match[1], isDeleted: true },
      { isDeleted: false, isActive: true, deletedAt: null, deletedBy: null },
      { new: true }
    );
    if (!lesson) return ctx.answerCbQuery('آموزش حذف‌شده پیدا نشد.', { show_alert: true });
    await audit(ctx.from.id, 'lesson_restore', 'AiLesson', lesson._id);
    await ctx.answerCbQuery('بازیابی شد.');
    return ctx.editMessageText(`✅ «${escapeHtml(lesson.title)}» بازیابی و فعال شد.`, {
      parse_mode: 'HTML', reply_markup: { inline_keyboard: [
        [{ text: '🎓 مدیریت آموزش‌ها', callback_data: 'a_lessons_1' }],
        [{ text: '🗑 آرشیو حذف‌شده‌ها', callback_data: 'a_lessons_deleted_1' }]
      ] }
    });
  });


  bot.action(/^a_lesson_purge_([a-f0-9]{24})$/, async ctx => {
    if (!ownerGuard(ctx)) return;
    const lesson = await AiLesson.findOne({ _id: ctx.match[1], isDeleted: true });
    if (!lesson) return ctx.answerCbQuery('آموزش باید ابتدا در آرشیو باشد.', { show_alert: true });
    await ctx.answerCbQuery();
    return ctx.editMessageText(permanentDeleteWarning('آموزش', `عنوان: ${escapeHtml(lesson.title)}`), {
      parse_mode: 'HTML', reply_markup: { inline_keyboard: [
        [{ text: '☠️ بله، برای همیشه حذف شود', callback_data: `a_lesson_purge_confirm_${lesson._id}`, style: 'danger' }],
        [{ text: '❌ انصراف', callback_data: 'a_lessons_deleted_1' }]
      ] }
    });
  });

  bot.action(/^a_lesson_purge_confirm_([a-f0-9]{24})$/, async ctx => {
    if (!ownerGuard(ctx)) return;
    const lesson = await AiLesson.findOne({ _id: ctx.match[1], isDeleted: true });
    if (!lesson) return ctx.answerCbQuery('آموزش پیدا نشد یا قبلاً حذف دائم شده است.', { show_alert: true });
    const id = lesson._id;
    await User.updateMany({}, { $pull: { lessonFavorites: id, recentLessons: id } });
    await AiLesson.deleteOne({ _id: id });
    await audit(ctx.from.id, 'lesson_permanent_delete', 'AiLesson', id);
    await ctx.answerCbQuery('آموزش برای همیشه حذف شد.');
    return ctx.editMessageText(`✅ آموزش «${escapeHtml(lesson.title)}» برای همیشه از دیتابیس حذف شد.`, {
      parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🗑 بازگشت به آرشیو', callback_data: 'a_lessons_deleted_1' }], adminBack[0]] }
    });
  });

  bot.action('a_lesson_add', async ctx => {
    if (!(await guard(ctx, 'lessons'))) return;
    setState(ctx.from.id, 'admin_lesson', { step: 'title', data: {} });
    await ctx.answerCbQuery();
    return ctx.reply('عنوان آموزش را بفرست.', { reply_markup: { inline_keyboard: [[{ text: '❌ لغو', callback_data: 'cancel_input', style: 'danger' }], adminBack[0]] } });
  });

  bot.action(/^a_requests_(\d+)$/, ctx => listGeneric(ctx, PromptRequest, { isDeleted: { $ne: true } }, Number(ctx.match[1]), 'a_requests', r => [{text:`${r.status==='approved'?'✅':r.status==='rejected'?'❌':'⏳'} ${String(r.text).slice(0,35)}`,callback_data:`a_request_${r._id}`}], 'requests'));
  bot.action(/^a_request_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'requests')))return; await ctx.answerCbQuery(); const r=await PromptRequest.findOne({_id:ctx.match[1],isDeleted:{$ne:true}}); if(!r)return ctx.answerCbQuery('درخواست پیدا نشد.',{show_alert:true}); return ctx.editMessageText(`📝 <b>درخواست</b>

${escapeHtml(r.text)}

وضعیت: ${r.status}
تاریخ: ${formatDateTime(r.createdAt)}`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✅ تأیید',callback_data:`req_approve_${r._id}`,style:'success'},{text:'❌ رد',callback_data:`req_reject_${r._id}`,style:'danger'}],[{text:'✏️ ویرایش متن',callback_data:`req_edit_${r._id}`},{text:'🗑 انتقال به آرشیو',callback_data:`req_delete_${r._id}`}],[{text:'🗑 آرشیو درخواست‌ها',callback_data:'a_requests_deleted_1'}],adminBack[0]]}}); });
  bot.action(/^req_(approve|reject)_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'requests')))return; const status=ctx.match[1]==='approve'?'approved':'rejected'; await PromptRequest.findOneAndUpdate({_id:ctx.match[2],isDeleted:{$ne:true}},{status,reviewedBy:ctx.from.id,reviewedAt:new Date()}); await ctx.answerCbQuery('ثبت شد.'); return ctx.editMessageText('✅ وضعیت درخواست به‌روزرسانی شد.',{reply_markup:{inline_keyboard:[[{text:'📝 بازگشت به درخواست‌ها',callback_data:'a_requests_1'}],adminBack[0]]}}); });
  bot.action(/^req_delete_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'requests')))return; const request=await PromptRequest.findOne({_id:ctx.match[1],isDeleted:{$ne:true}}); if(!request)return ctx.answerCbQuery('درخواست پیدا نشد.',{show_alert:true}); await ctx.answerCbQuery(); return ctx.editMessageText(`🗑 <b>آرشیو درخواست</b>

${escapeHtml(String(request.text).slice(0,200))}

درخواست از لیست فعال خارج می‌شود و قابل بازیابی خواهد بود.`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✅ انتقال به آرشیو',callback_data:`req_delete_confirm_${request._id}`,style:'danger'}],[{text:'❌ انصراف',callback_data:`a_request_${request._id}`}]]}}); });
  bot.action(/^req_delete_confirm_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'requests')))return; const request=await PromptRequest.findOneAndUpdate({_id:ctx.match[1],isDeleted:{$ne:true}},{isDeleted:true,deletedAt:new Date(),deletedBy:ctx.from.id},{new:true}); if(!request)return ctx.answerCbQuery('درخواست پیدا نشد.',{show_alert:true}); await audit(ctx.from.id,'request_soft_delete','PromptRequest',request._id); await ctx.answerCbQuery('به آرشیو منتقل شد.'); return ctx.editMessageText('✅ درخواست به آرشیو منتقل شد.',{reply_markup:{inline_keyboard:[[{text:'📝 درخواست‌های فعال',callback_data:'a_requests_1'}],[{text:'🗑 آرشیو درخواست‌ها',callback_data:'a_requests_deleted_1'}],adminBack[0]]}}); });
  bot.action(/^a_requests_deleted_(\d+)$/, async ctx=>{ if(!(await guard(ctx,'requests')))return; const page=Number(ctx.match[1]); const query={isDeleted:true}; const total=await PromptRequest.countDocuments(query); const pages=Math.max(1,Math.ceil(total/PAGE_SIZE)); const current=Math.min(Math.max(page,1),pages); const items=await PromptRequest.find(query).sort({deletedAt:-1}).skip((current-1)*PAGE_SIZE).limit(PAGE_SIZE); const rows=items.map(r=>[{text:`♻️ ${String(r.text).slice(0,24)}`,callback_data:`req_restore_${r._id}`},{text:'☠️ حذف دائم',callback_data:`req_purge_${r._id}`,style:'danger'}]); rows.push(paginationRow(current,pages,'a_requests_deleted')); rows.push([{text:'🔙 درخواست‌های فعال',callback_data:'a_requests_1'}]); rows.push(adminBack[0]); await ctx.answerCbQuery().catch(()=>{}); return ctx.editMessageText(`🗑 آرشیو درخواست‌ها | ${total} مورد`,{reply_markup:{inline_keyboard:rows}}); });
  bot.action(/^req_restore_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'requests')))return; const request=await PromptRequest.findOneAndUpdate({_id:ctx.match[1],isDeleted:true},{isDeleted:false,deletedAt:null,deletedBy:null},{new:true}); if(!request)return ctx.answerCbQuery('درخواست پیدا نشد.',{show_alert:true}); await audit(ctx.from.id,'request_restore','PromptRequest',request._id); await ctx.answerCbQuery('بازیابی شد.'); return ctx.editMessageText('✅ درخواست بازیابی شد.',{reply_markup:{inline_keyboard:[[{text:'📝 درخواست‌های فعال',callback_data:'a_requests_1'}],[{text:'🗑 آرشیو',callback_data:'a_requests_deleted_1'}]]}}); });
  bot.action(/^req_purge_([a-f0-9]{24})$/, async ctx=>{ if(!ownerGuard(ctx))return; const request=await PromptRequest.findOne({_id:ctx.match[1],isDeleted:true}); if(!request)return ctx.answerCbQuery('درخواست باید ابتدا در آرشیو باشد.',{show_alert:true}); await ctx.answerCbQuery(); return ctx.editMessageText(permanentDeleteWarning('درخواست',`متن: ${escapeHtml(String(request.text).slice(0,200))}`),{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'☠️ حذف دائم درخواست',callback_data:`req_purge_confirm_${request._id}`,style:'danger'}],[{text:'❌ انصراف',callback_data:'a_requests_deleted_1'}]]}}); });
  bot.action(/^req_purge_confirm_([a-f0-9]{24})$/, async ctx=>{ if(!ownerGuard(ctx))return; const request=await PromptRequest.findOneAndDelete({_id:ctx.match[1],isDeleted:true}); if(!request)return ctx.answerCbQuery('درخواست پیدا نشد.',{show_alert:true}); await audit(ctx.from.id,'request_permanent_delete','PromptRequest',request._id); await ctx.answerCbQuery('برای همیشه حذف شد.'); return ctx.editMessageText('✅ درخواست برای همیشه از دیتابیس حذف شد.',{reply_markup:{inline_keyboard:[[{text:'🗑 بازگشت به آرشیو',callback_data:'a_requests_deleted_1'}],adminBack[0]]}}); });
  bot.action(/^req_edit_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'requests')))return; setState(ctx.from.id,'request_edit',{id:ctx.match[1]}); await ctx.answerCbQuery(); return ctx.reply('متن جدید درخواست را بفرست.'); });

  bot.action(/^a_payments_(\d+)$/, ctx => listGeneric(ctx, Payment, { isDeleted: { $ne: true } }, Number(ctx.match[1]), 'a_payments', p => [{text:`${p.status==='approved'?'✅':p.status==='rejected'?'❌':'⏳'} ${p.paymentCode} | ${formatToman(p.finalPrice)}`,callback_data:`a_payment_${p._id}`}], 'payments'));
  bot.action(/^a_payment_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'payments')))return; await ctx.answerCbQuery(); const p=await Payment.findOne({_id:ctx.match[1],isDeleted:{$ne:true}}); if(!p)return ctx.answerCbQuery('پرداخت پیدا نشد.',{show_alert:true}); const u=await User.findOne({telegramId:p.userTelegramId}); return ctx.editMessageText(`💳 <b>${p.paymentCode}</b>

👤 ${escapeHtml(u?.firstName||'کاربر')} ${u?.username?`(@${escapeHtml(u.username)})`:''}
🆔 <code>${p.userTelegramId}</code>
نوع: ${p.type}
مبلغ: ${formatToman(p.finalPrice)}
تاریخ: ${formatDateTime(p.createdAt)}
وضعیت: ${p.status}`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🗑 انتقال به آرشیو',callback_data:`a_payment_delete_${p._id}`,style:'danger'}],[{text:'🗑 آرشیو پرداخت‌ها',callback_data:'a_payments_deleted_1'}],adminBack[0]]}}); });
  bot.action(/^a_payment_delete_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'payments')))return; const p=await Payment.findOne({_id:ctx.match[1],isDeleted:{$ne:true}}); if(!p)return ctx.answerCbQuery('پرداخت پیدا نشد.',{show_alert:true}); await ctx.answerCbQuery(); return ctx.editMessageText(`🗑 <b>آرشیو پرداخت</b>

کد: <code>${escapeHtml(p.paymentCode||String(p._id))}</code>
مبلغ: ${formatToman(p.finalPrice)}
وضعیت: ${p.status}

این کار اثر مالی پرداخت تأییدشده را برنمی‌گرداند؛ فقط رکورد را از لیست فعال خارج می‌کند.`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✅ انتقال به آرشیو',callback_data:`a_payment_delete_confirm_${p._id}`,style:'danger'}],[{text:'❌ انصراف',callback_data:`a_payment_${p._id}`}]]}}); });
  bot.action(/^a_payment_delete_confirm_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'payments')))return; const p=await Payment.findOneAndUpdate({_id:ctx.match[1],isDeleted:{$ne:true}},{isDeleted:true,deletedAt:new Date(),deletedBy:ctx.from.id},{new:true}); if(!p)return ctx.answerCbQuery('پرداخت پیدا نشد.',{show_alert:true}); await audit(ctx.from.id,'payment_soft_delete','Payment',p._id); await ctx.answerCbQuery('به آرشیو منتقل شد.'); return ctx.editMessageText('✅ پرداخت به آرشیو منتقل شد.',{reply_markup:{inline_keyboard:[[{text:'💳 پرداخت‌های فعال',callback_data:'a_payments_1'}],[{text:'🗑 آرشیو پرداخت‌ها',callback_data:'a_payments_deleted_1'}],adminBack[0]]}}); });
  bot.action(/^a_payments_deleted_(\d+)$/, async ctx=>{ if(!(await guard(ctx,'payments')))return; const page=Number(ctx.match[1]); const query={isDeleted:true}; const total=await Payment.countDocuments(query); const pages=Math.max(1,Math.ceil(total/PAGE_SIZE)); const current=Math.min(Math.max(page,1),pages); const items=await Payment.find(query).sort({deletedAt:-1}).skip((current-1)*PAGE_SIZE).limit(PAGE_SIZE); const rows=items.map(p=>[{text:`♻️ ${p.paymentCode||p._id}`,callback_data:`a_payment_restore_${p._id}`},{text:'☠️ حذف دائم',callback_data:`a_payment_purge_${p._id}`,style:'danger'}]); rows.push(paginationRow(current,pages,'a_payments_deleted')); rows.push([{text:'🔙 پرداخت‌های فعال',callback_data:'a_payments_1'}]); rows.push(adminBack[0]); await ctx.answerCbQuery().catch(()=>{}); return ctx.editMessageText(`🗑 آرشیو پرداخت‌ها | ${total} مورد`,{reply_markup:{inline_keyboard:rows}}); });
  bot.action(/^a_payment_restore_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'payments')))return; const p=await Payment.findOneAndUpdate({_id:ctx.match[1],isDeleted:true},{isDeleted:false,deletedAt:null,deletedBy:null},{new:true}); if(!p)return ctx.answerCbQuery('پرداخت پیدا نشد.',{show_alert:true}); await audit(ctx.from.id,'payment_restore','Payment',p._id); await ctx.answerCbQuery('بازیابی شد.'); return ctx.editMessageText('✅ پرداخت به لیست فعال برگشت.',{reply_markup:{inline_keyboard:[[{text:'💳 پرداخت‌ها',callback_data:'a_payments_1'}],[{text:'🗑 آرشیو',callback_data:'a_payments_deleted_1'}]]}}); });
  bot.action(/^a_payment_purge_([a-f0-9]{24})$/, async ctx=>{ if(!ownerGuard(ctx))return; const p=await Payment.findOne({_id:ctx.match[1],isDeleted:true}); if(!p)return ctx.answerCbQuery('پرداخت باید ابتدا در آرشیو باشد.',{show_alert:true}); await ctx.answerCbQuery(); return ctx.editMessageText(permanentDeleteWarning('پرداخت',`کد: <code>${escapeHtml(p.paymentCode||String(p._id))}</code>
مبلغ: ${formatToman(p.finalPrice)}
وضعیت: ${p.status}

⚠️ حذف رکورد پرداخت، اشتراک فعال‌شده یا موجودی کیف پول را خودکار برنمی‌گرداند.`),{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'☠️ حذف دائم پرداخت',callback_data:`a_payment_purge_confirm_${p._id}`,style:'danger'}],[{text:'❌ انصراف',callback_data:'a_payments_deleted_1'}]]}}); });
  bot.action(/^a_payment_purge_confirm_([a-f0-9]{24})$/, async ctx=>{ if(!ownerGuard(ctx))return; const p=await Payment.findOneAndDelete({_id:ctx.match[1],isDeleted:true}); if(!p)return ctx.answerCbQuery('پرداخت پیدا نشد.',{show_alert:true}); await Promise.all([GiftCode.updateMany({paymentId:p._id},{$set:{paymentId:null}}),WalletTransaction.updateMany({referenceId:p._id,referenceType:'payment'},{$set:{referenceId:null}})]); await audit(ctx.from.id,'payment_permanent_delete','Payment',p._id,{paymentCode:p.paymentCode,status:p.status,finalPrice:p.finalPrice}); await ctx.answerCbQuery('برای همیشه حذف شد.'); return ctx.editMessageText('✅ رکورد پرداخت برای همیشه از دیتابیس حذف شد. اثر مالی قبلی دست‌نخورده باقی مانده است.',{reply_markup:{inline_keyboard:[[{text:'🗑 بازگشت به آرشیو',callback_data:'a_payments_deleted_1'}],adminBack[0]]}}); });
  bot.action(/^pay_approve_([a-f0-9]{24})$/, async ctx => { if (!(await guard(ctx,'payments'))) return; await ctx.answerCbQuery(); const p=await Payment.findById(ctx.match[1]); if(!p||p.status!=='pending')return;
    p.status='approved';p.reviewedBy=ctx.from.id;p.reviewedAt=new Date();await p.save(); let message='✅ پرداخت تأیید شد.';
    if(p.type==='wallet_topup'){ await creditWallet(p.userTelegramId,p.finalPrice,{referenceId:p._id,createdBy:ctx.from.id}); message=`✅ کیف پولت ${formatToman(p.finalPrice)} شارژ شد.`; }
    else if(p.type==='gift_purchase'){ const gift=await createGift({buyerTelegramId:p.userTelegramId,paymentId:p._id,vipDays:env.vipDays}); const link=`https://t.me/${env.botUsername}?start=gift_${gift.code}`; message=`🎁 پرداخت هدیه تأیید شد. لینک یک‌بارمصرف هدیه:\n${link}`; }
    else { const user=await activateOrExtendVip(p.userTelegramId,env.vipDays); message=`👑 پرداخت تأیید شد. VIP تا ${user.vipUntil.toLocaleDateString('fa-IR')} فعال است.`; }
    await consumeCode(p.discountCode,p.userTelegramId); await ctx.telegram.sendMessage(p.userTelegramId,message).catch(()=>{}); await audit(ctx.from.id,'payment_approve','Payment',p._id,{type:p.type}); return ctx.editMessageCaption(`✅ پرداخت تأیید شد\n${p.paymentCode}\n${message}`).catch(()=>ctx.reply(message)); });
  bot.action(/^pay_reject_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'payments')))return; const p=await Payment.findById(ctx.match[1]); if(!p||p.status!=='pending')return; p.status='rejected';p.reviewedBy=ctx.from.id;p.reviewedAt=new Date();p.rejectionReason='رد شده توسط مدیریت';await p.save(); await ctx.telegram.sendMessage(p.userTelegramId,'❌ پرداخت تأیید نشد. برای پیگیری با پشتیبانی در ارتباط باش.').catch(()=>{}); await ctx.answerCbQuery('رد شد.'); return ctx.editMessageCaption(`❌ پرداخت رد شد\n${p.paymentCode}`).catch(()=>{}); });

  bot.action(/^result_score_(.+)_([1-9]|10)$/, async ctx=>{ if(!(await guard(ctx,'results')))return; const r=await PromptResult.findById(ctx.match[1]); if(!r)return; r.status='approved';r.adminScore=Number(ctx.match[2]);r.reviewedBy=ctx.from.id;r.reviewedAt=new Date();await r.save(); await ctx.telegram.sendMessage(r.userTelegramId,`🎉 نتیجه‌ات تأیید شد و امتیاز ${r.adminScore}/10 گرفت.`).catch(()=>{}); await ctx.answerCbQuery('تأیید شد.'); return ctx.editMessageCaption(`✅ نتیجه تأیید شد | امتیاز ${r.adminScore}/10`).catch(()=>{}); });
  bot.action(/^result_reject_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'results')))return; const r=await PromptResult.findByIdAndUpdate(ctx.match[1],{status:'rejected',reviewedBy:ctx.from.id,reviewedAt:new Date()},{new:true}); if(r)await ctx.telegram.sendMessage(r.userTelegramId,'❌ نتیجه ارسالی تأیید نشد.').catch(()=>{}); await ctx.answerCbQuery('رد شد.'); });

  bot.action(/^a_codes_(\d+)$/, async ctx=>{
    if(!(await guard(ctx,'discounts')))return;
    const page=Number(ctx.match[1]);
    const query={isDeleted:{$ne:true}};
    const total=await DiscountCode.countDocuments(query);
    const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
    const items=await DiscountCode.find(query).sort({createdAt:-1}).skip((page-1)*PAGE_SIZE).limit(PAGE_SIZE);
    const rows=[
      [{text:'➕ ساخت کد تخفیف',callback_data:'a_code_add',style:'success'}],
      ...items.map(c=>[{text:`🎟 ${c.title} | ${c.code} (${c.usedCount}/${c.maxUses})`,callback_data:`a_code_view_${c._id}`}]),
      [{text:'🗑 کدهای حذف‌شده',callback_data:'a_codes_deleted_1'}],
      paginationRow(page,pages,'a_codes'),
      adminBack[0]
    ];
    await ctx.answerCbQuery().catch(()=>{});
    return ctx.editMessageText(`🎟 کدهای تخفیف فعال | ${total} مورد`,{reply_markup:{inline_keyboard:rows}}).catch(()=>ctx.reply('🎟 کدهای تخفیف',{reply_markup:{inline_keyboard:rows}}));
  });
  bot.action('a_code_add',async ctx=>{if(!(await guard(ctx,'discounts')))return;setState(ctx.from.id,'admin_code',{step:'title',data:{}});await ctx.answerCbQuery();return ctx.reply('عنوان کمپین/کد را بفرست.');});
  bot.action(/^a_code_view_([a-f0-9]{24})$/,async ctx=>{
    if(!(await guard(ctx,'discounts')))return;
    const c=await DiscountCode.findById(ctx.match[1]);
    await ctx.answerCbQuery();
    if(!c)return ctx.reply('کد پیدا نشد.');
    return ctx.editMessageText(`🎟 <b>${escapeHtml(c.title)}</b>\n\nکد: <code>${c.code}</code>\nتخفیف: ${c.type==='percent'?`${c.value}٪`:formatToman(c.value)}\nاستفاده: ${c.usedCount}/${c.maxUses}\nساخته‌شده: ${formatDateTime(c.createdAt)}\nانقضا: ${formatDateTime(c.expiresAt)}\nوضعیت: ${c.isActive?'فعال':'غیرفعال'}`,{
      parse_mode:'HTML',
      reply_markup:{inline_keyboard:[
        [{text:'🗑 حذف کد تخفیف',callback_data:`a_code_delete_${c._id}`,style:'danger'}],
        adminBack[0]
      ]}
    });
  });
  bot.action(/^a_code_delete_([a-f0-9]{24})$/,async ctx=>{
    if(!(await guard(ctx,'discounts')))return;
    const c=await DiscountCode.findById(ctx.match[1]);
    await ctx.answerCbQuery();
    if(!c)return;
    return ctx.editMessageText(`⚠️ <b>حذف کد تخفیف</b>\n\nعنوان: ${escapeHtml(c.title)}\nکد: <code>${c.code}</code>\nاستفاده ثبت‌شده: ${c.usedCount}\n\nتاریخچه استفاده حذف نمی‌شود. از حذف این کد مطمئنی؟`,{
      parse_mode:'HTML',
      reply_markup:{inline_keyboard:[
        [{text:'✅ تأیید حذف',callback_data:`a_code_delete_confirm_${c._id}`,style:'danger'}],
        [{text:'❌ انصراف',callback_data:`a_code_view_${c._id}`}],
        adminBack[0]
      ]}
    });
  });
  bot.action(/^a_code_delete_confirm_([a-f0-9]{24})$/,async ctx=>{
    if(!(await guard(ctx,'discounts')))return;
    await DiscountCode.findByIdAndUpdate(ctx.match[1],{isDeleted:true,isActive:false,deletedAt:new Date(),deletedBy:ctx.from.id});
    await audit(ctx.from.id,'discount_soft_delete','DiscountCode',ctx.match[1]);
    await ctx.answerCbQuery('کد حذف شد.');
    return ctx.editMessageText('✅ کد تخفیف حذف شد. تاریخچه استفاده آن حفظ شده است.',{reply_markup:{inline_keyboard:[adminBack[0]]}});
  });
  bot.action(/^a_codes_deleted_(\d+)$/,async ctx=>{
    if(!(await guard(ctx,'discounts')))return;
    const page=Number(ctx.match[1]);
    const query={isDeleted:true};
    const total=await DiscountCode.countDocuments(query);
    const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
    const items=await DiscountCode.find(query).sort({deletedAt:-1}).skip((page-1)*PAGE_SIZE).limit(PAGE_SIZE);
    const rows=[
      ...items.map(c=>[{text:`♻️ ${c.title} | ${c.code}`,callback_data:`a_code_restore_${c._id}`},{text:'☠️ حذف دائم',callback_data:`a_code_purge_${c._id}`,style:'danger'}]),
      paginationRow(page,pages,'a_codes_deleted'),
      [{text:'🔙 کدهای فعال',callback_data:'a_codes_1'}],
      adminBack[0]
    ];
    await ctx.answerCbQuery().catch(()=>{});
    return ctx.editMessageText(`🗑 کدهای حذف‌شده | ${total} مورد\n\nبرای بازیابی روی کد بزن.`,{reply_markup:{inline_keyboard:rows}});
  });
  bot.action(/^a_code_restore_([a-f0-9]{24})$/,async ctx=>{
    if(!(await guard(ctx,'discounts')))return;
    await DiscountCode.findByIdAndUpdate(ctx.match[1],{isDeleted:false,isActive:true,deletedAt:null,deletedBy:null});
    await audit(ctx.from.id,'discount_restore','DiscountCode',ctx.match[1]);
    await ctx.answerCbQuery('بازیابی شد.');
    return ctx.editMessageText('✅ کد تخفیف دوباره فعال شد.',{reply_markup:{inline_keyboard:[adminBack[0]]}});
  });


  bot.action(/^a_code_purge_([a-f0-9]{24})$/, async ctx=>{
    if(!ownerGuard(ctx))return;
    const c=await DiscountCode.findOne({_id:ctx.match[1],isDeleted:true});
    if(!c)return ctx.answerCbQuery('کد باید ابتدا در آرشیو باشد.',{show_alert:true});
    await ctx.answerCbQuery();
    return ctx.editMessageText(permanentDeleteWarning('کد تخفیف',`عنوان: ${escapeHtml(c.title)}
کد: <code>${escapeHtml(c.code)}</code>
استفاده ثبت‌شده: ${c.usedCount}`),{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'☠️ حذف دائم کد',callback_data:`a_code_purge_confirm_${c._id}`,style:'danger'}],[{text:'❌ انصراف',callback_data:'a_codes_deleted_1'}]]}});
  });
  bot.action(/^a_code_purge_confirm_([a-f0-9]{24})$/, async ctx=>{
    if(!ownerGuard(ctx))return;
    const c=await DiscountCode.findOneAndDelete({_id:ctx.match[1],isDeleted:true});
    if(!c)return ctx.answerCbQuery('کد پیدا نشد.',{show_alert:true});
    await User.updateMany({appliedDiscountCode:c.code},{$set:{appliedDiscountCode:null}});
    await audit(ctx.from.id,'discount_permanent_delete','DiscountCode',c._id,{code:c.code,usedCount:c.usedCount});
    await ctx.answerCbQuery('برای همیشه حذف شد.');
    return ctx.editMessageText(`✅ کد <code>${escapeHtml(c.code)}</code> برای همیشه از دیتابیس حذف شد.`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🗑 بازگشت به آرشیو',callback_data:'a_codes_deleted_1'}],adminBack[0]]}});
  });

  bot.action('a_admins',async ctx=>{if(!isOwner(ctx.from.id))return ctx.answerCbQuery('فقط مالک.');const rows=await Admin.find().sort({createdAt:-1});await ctx.answerCbQuery();const buttons=rows.map(a=>[{text:`${a.isActive?'✅':'❌'} ${a.telegramId} | ${a.title}`,callback_data:`a_admin_${a._id}`}]);buttons.unshift([{text:'➕ افزودن ادمین',callback_data:'a_admin_add',style:'success'}]);buttons.push(adminBack[0]);return ctx.editMessageText(`🛡 مدیریت ادمین‌ها\n\n${rows.length} ادمین ثبت شده.`,{reply_markup:{inline_keyboard:buttons}});});
  bot.action('a_admin_add',async ctx=>{if(!isOwner(ctx.from.id))return;setState(ctx.from.id,'admin_add',{step:'id',data:{}});await ctx.answerCbQuery();return ctx.reply('آیدی عددی ادمین را بفرست.');});
  bot.action(/^a_admin_([a-f0-9]{24})$/,async ctx=>{if(!isOwner(ctx.from.id))return;const a=await Admin.findById(ctx.match[1]);if(!a)return;await ctx.answerCbQuery();const enabled=Object.entries(a.permissions.toObject?a.permissions.toObject():a.permissions).filter(([,v])=>v).map(([k])=>k).join(', ')||'بدون دسترسی';return ctx.editMessageText(`🛡 ${a.telegramId}\nعنوان: ${a.title}\nوضعیت: ${a.isActive?'فعال':'غیرفعال'}\nمجوزها: ${enabled}`,{reply_markup:{inline_keyboard:[[{text:'✏️ تغییر مجوزها',callback_data:`a_admin_perms_${a._id}`}],[{text:a.isActive?'⏸ غیرفعال':'▶️ فعال',callback_data:`a_admin_toggle_${a._id}`}],[{text:'🗑 حذف ادمین',callback_data:`a_admin_delete_${a._id}`,style:'danger'}],adminBack[0]]}});});
  bot.action(/^a_admin_perms_([a-f0-9]{24})$/,async ctx=>{if(!isOwner(ctx.from.id))return;setState(ctx.from.id,'admin_edit_perms',{id:ctx.match[1]});await ctx.answerCbQuery();return ctx.reply('مجوزهای جدید را با ویرگول بفرست؛ مثال: prompts,lessons یا all');});
  bot.action(/^a_admin_toggle_([a-f0-9]{24})$/,async ctx=>{if(!isOwner(ctx.from.id))return;const a=await Admin.findById(ctx.match[1]);if(a){a.isActive=!a.isActive;await a.save();}await ctx.answerCbQuery('تغییر کرد.');return ctx.editMessageText('✅ وضعیت ادمین به‌روزرسانی شد.',{reply_markup:{inline_keyboard:[[{text:'🛡 بازگشت به مدیریت ادمین‌ها',callback_data:'a_admins'}],adminBack[0]]}});});
  bot.action(/^a_admin_delete_([a-f0-9]{24})$/, async ctx => {
    if (!isOwner(ctx.from.id)) return ctx.answerCbQuery('فقط مالک اجازه حذف ادمین را دارد.', { show_alert: true });
    const admin = await Admin.findById(ctx.match[1]);
    if (!admin) return ctx.answerCbQuery('ادمین پیدا نشد.', { show_alert: true });
    await ctx.answerCbQuery();
    return ctx.editMessageText(
      `⚠️ <b>حذف ادمین</b>

آیدی: <code>${admin.telegramId}</code>
عنوان: ${escapeHtml(admin.title || 'ادمین')}

از حذف این ادمین مطمئنی؟`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ بله، حذف شود', callback_data: `a_admin_delete_confirm_${admin._id}`, style: 'danger' }],
            [{ text: '🔙 انصراف', callback_data: `a_admin_${admin._id}` }]
          ]
        }
      }
    );
  });

  bot.action(/^a_admin_delete_confirm_([a-f0-9]{24})$/, async ctx => {
    if (!isOwner(ctx.from.id)) return ctx.answerCbQuery('فقط مالک.', { show_alert: true });
    const admin = await Admin.findByIdAndDelete(ctx.match[1]);
    if (!admin) return ctx.answerCbQuery('ادمین قبلاً حذف شده یا وجود ندارد.', { show_alert: true });
    await audit(ctx.from.id, 'admin_delete', 'Admin', admin._id);
    await ctx.answerCbQuery('ادمین حذف شد.');
    return showAdmin(ctx);
  });

  bot.action('a_broadcast',async ctx=>{if(!(await guard(ctx,'broadcast')))return;setState(ctx.from.id,'broadcast',{step:'message'});await ctx.answerCbQuery();return ctx.reply('پیام نهایی را بفرست؛ بعد پیش‌نمایش و تأیید می‌گیری.');});
  bot.action('broadcast_confirm',async ctx=>{if(!(await guard(ctx,'broadcast')))return;const state=getState(ctx.from.id);if(!state||state.type!=='broadcast_preview')return;const users=await User.find({isBlocked:false});let ok=0,fail=0;for(const u of users){try{await ctx.telegram.copyMessage(u.telegramId,state.data.chatId,state.data.messageId);ok++;}catch{fail++;}}clearState(ctx.from.id);await ctx.answerCbQuery();return ctx.reply(`✅ ارسال شد\nموفق: ${ok}\nناموفق: ${fail}`);});

  bot.action('a_channel_post', async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    setState(ctx.from.id, 'channel_post', { step: 'type', data: { buttonRows: [], mediaFileIds: [] } });
    await ctx.answerCbQuery();
    return ctx.reply('📣 <b>ساخت پست حرفه‌ای کانال</b>\n\nنوع محتوا را انتخاب کن.', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [
        [{ text: '🖼 یک تصویر', callback_data: 'channel_type_photo' }, { text: '🎞 آلبوم تصاویر', callback_data: 'channel_type_album' }],
        [{ text: '🎬 ویدیو', callback_data: 'channel_type_video' }, { text: '📝 متن', callback_data: 'channel_type_text' }],
        adminBack[0]
      ] }
    });
  });

  bot.action(/^channel_type_(photo|video|text|album)$/, async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const type = ctx.match[1];
    const step = type === 'text' ? 'caption' : type === 'album' ? 'album_media' : 'media';
    setState(ctx.from.id, 'channel_post', { step, data: { type, buttonRows: [], mediaFileIds: [] } });
    await ctx.answerCbQuery();
    if (type === 'album') {
      return ctx.reply('🎞 <b>آلبوم تصاویر</b>\n\nبین ۲ تا ۱۰ عکس بفرست. می‌توانی عکس‌ها را یکی‌یکی یا به‌صورت گروهی ارسال کنی.\nوقتی تمام شد، دکمه «پایان انتخاب تصاویر» را بزن.', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: '✅ پایان انتخاب تصاویر', callback_data: 'channel_album_done', style: 'success' }],
          [{ text: '🗑 حذف آخرین عکس', callback_data: 'channel_album_remove_last' }],
          [{ text: '❌ لغو', callback_data: 'cancel_input', style: 'danger' }]
        ] }
      });
    }
    return ctx.reply(type === 'text'
      ? '📝 متن نهایی پست را بفرست. می‌توانی از HTML ساده مثل <b>Bold</b> استفاده کنی.'
      : '📎 فایل رسانه را بفرست.');
  });

  bot.action('channel_album_remove_last', async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const state = getState(ctx.from.id);
    if (!state || state.type !== 'channel_post' || state.data?.step !== 'album_media') return ctx.answerCbQuery('مرحله آلبوم فعال نیست.', { show_alert: true });
    const ids = state.data.data.mediaFileIds || [];
    if (!ids.length) return ctx.answerCbQuery('هنوز عکسی ثبت نشده.', { show_alert: true });
    ids.pop();
    setState(ctx.from.id, 'channel_post', state.data);
    return ctx.answerCbQuery(`حذف شد. ${ids.length}/10 عکس باقی مانده.`);
  });

  bot.action('channel_album_done', async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const state = getState(ctx.from.id);
    if (!state || state.type !== 'channel_post' || state.data?.step !== 'album_media') return ctx.answerCbQuery('مرحله آلبوم فعال نیست.', { show_alert: true });
    const flow = state.data;
    const ids = flow.data.mediaFileIds || [];
    if (ids.length < 2) return ctx.answerCbQuery('برای آلبوم حداقل ۲ تصویر لازم است.', { show_alert: true });
    flow.step = 'caption';
    setState(ctx.from.id, 'channel_post', flow);
    await ctx.answerCbQuery(`آلبوم با ${ids.length} تصویر ثبت شد.`);
    return ctx.reply('📝 کپشن نهایی آلبوم را بفرست.');
  });

  bot.action('channel_button_add', async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const s = getState(ctx.from.id); if (!s || s.type !== 'channel_post_builder') return;
    setState(ctx.from.id, 'channel_post', { step: 'button_text', data: s.data });
    await ctx.answerCbQuery();
    return ctx.reply('📝 متن دکمه را بفرست.\nمثال: دریافت پرامپت دختر تابستانی');
  });

  bot.action(/^channel_prompt_page_(\d+)$/, async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const s = getState(ctx.from.id); if (!s || !['channel_post_builder', 'channel_post'].includes(s.type)) return;
    const page = Number(ctx.match[1]); const total = await Prompt.countDocuments({ isActive: true, isDeleted: { $ne: true } }); const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const items = await Prompt.find({ isActive: true, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE);
    const rows = items.map(p => [{ text: `✨ ${p.title}`, callback_data: `channel_pick_prompt_${p._id}` }]);
    rows.push(paginationRow(page, pages, 'channel_prompt_page'));
    rows.push([{ text: '🔙 بازگشت به پست‌ساز', callback_data: 'channel_builder' }]);
    await ctx.answerCbQuery().catch(() => {});
    return ctx.editMessageText('🤖 یک پرامپت را انتخاب کن تا لینک دریافت آن به دکمه متصل شود.', { reply_markup: { inline_keyboard: rows } }).catch(() => ctx.reply('🤖 یک پرامپت را انتخاب کن.', { reply_markup: { inline_keyboard: rows } }));
  });

  bot.action(/^channel_pick_prompt_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const current = getState(ctx.from.id); if (!current) return;
    const p = await Prompt.findById(ctx.match[1]); if (!p) return ctx.answerCbQuery('پرامپت پیدا نشد.');
    const data = current.data;
    data.pendingButton = { text: `📥 دریافت ${p.title}`, url: `https://t.me/${env.botUsername}?start=prompt_${p.slug}` };
    setState(ctx.from.id, 'channel_post', { step: 'prompt_button_text', data });
    await ctx.answerCbQuery();
    return ctx.reply(`✅ پرامپت انتخاب شد: ${p.title}\n\nعنوان دکمه را بفرست یا «خودکار» بنویس تا این عنوان استفاده شود:\n${data.pendingButton.text}`);
  });

  bot.action('channel_place_new', async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const s = getState(ctx.from.id); if (!s || s.type !== 'channel_post_place') return;
    try { addChannelButton(s.data, s.data.pendingButton, 'new'); } catch (e) { return ctx.answerCbQuery(e.message, { show_alert: true }); }
    delete s.data.pendingButton; setState(ctx.from.id, 'channel_post_builder', s.data); await ctx.answerCbQuery('دکمه اضافه شد.');
    return ctx.editMessageText(`✅ دکمه اضافه شد.\nتعداد دکمه‌ها: ${s.data.buttonRows.flat().length}`, { reply_markup: channelBuilderKeyboard(s.data) }).catch(() => ctx.reply('✅ دکمه اضافه شد.', { reply_markup: channelBuilderKeyboard(s.data) }));
  });

  bot.action('channel_place_same', async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const s = getState(ctx.from.id); if (!s || s.type !== 'channel_post_place') return;
    try { addChannelButton(s.data, s.data.pendingButton, 'same'); } catch (e) { return ctx.answerCbQuery(e.message, { show_alert: true }); }
    delete s.data.pendingButton; setState(ctx.from.id, 'channel_post_builder', s.data); await ctx.answerCbQuery('دکمه اضافه شد.');
    return ctx.editMessageText(`✅ دکمه اضافه شد.\nتعداد دکمه‌ها: ${s.data.buttonRows.flat().length}`, { reply_markup: channelBuilderKeyboard(s.data) }).catch(() => ctx.reply('✅ دکمه اضافه شد.', { reply_markup: channelBuilderKeyboard(s.data) }));
  });

  bot.action('channel_builder', async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const s = getState(ctx.from.id); if (!s) return;
    setState(ctx.from.id, 'channel_post_builder', s.data);
    await ctx.answerCbQuery().catch(() => {});
    return ctx.editMessageText(`🧩 <b>پست‌ساز کانال</b>\n\nدکمه‌های فعلی: ${(s.data.buttonRows || []).flat().length}\nمی‌توانی چند دکمه لینک‌دار اضافه کنی یا پیش‌نمایش نهایی را ببینی.`, { parse_mode: 'HTML', reply_markup: channelBuilderKeyboard(s.data) }).catch(() => ctx.reply('🧩 پست‌ساز کانال', { reply_markup: channelBuilderKeyboard(s.data) }));
  });

  bot.action('channel_buttons_manage', async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const s = getState(ctx.from.id); if (!s) return;
    const flat = []; (s.data.buttonRows || []).forEach((row, ri) => row.forEach((b, bi) => flat.push({ ri, bi, b })));
    const rows = flat.map(({ ri, bi, b }, i) => [{ text: `🗑 ${i + 1}. ${b.text}`, callback_data: `channel_button_remove_${ri}_${bi}`, style: 'danger' }]);
    rows.push([{ text: '🔙 بازگشت به پست‌ساز', callback_data: 'channel_builder' }]);
    await ctx.answerCbQuery();
    return ctx.editMessageText('🧩 برای حذف هر دکمه روی آن بزن.', { reply_markup: { inline_keyboard: rows } });
  });

  bot.action(/^channel_button_remove_(\d+)_(\d+)$/, async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const s = getState(ctx.from.id); if (!s) return;
    const ri = Number(ctx.match[1]), bi = Number(ctx.match[2]);
    if (s.data.buttonRows?.[ri]?.[bi]) { s.data.buttonRows[ri].splice(bi, 1); if (!s.data.buttonRows[ri].length) s.data.buttonRows.splice(ri, 1); }
    setState(ctx.from.id, 'channel_post_builder', s.data); await ctx.answerCbQuery('حذف شد.');
    return ctx.editMessageText(`✅ دکمه حذف شد.\nتعداد باقی‌مانده: ${(s.data.buttonRows || []).flat().length}`, { reply_markup: channelBuilderKeyboard(s.data) });
  });

  bot.action('channel_preview', async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const s = getState(ctx.from.id); if (!s) return;
    await ctx.answerCbQuery();
    await sendChannelPreview(ctx, s.data);
    setState(ctx.from.id, 'channel_post_preview', s.data);
    return ctx.reply('👁 پیش‌نمایش بالا آماده است. روش انتشار را انتخاب کن.', { reply_markup: { inline_keyboard: [
      [{ text: `🚀 انتشار فوری در ${env.channelUsername}`, callback_data: 'channel_publish', style: 'success' }],
      [{ text: '🕒 زمان‌بندی انتشار', callback_data: 'channel_schedule' }],
      [{ text: '✏️ بازگشت به ویرایش', callback_data: 'channel_builder' }],
      [{ text: '❌ لغو', callback_data: 'cancel_input', style: 'danger' }]
    ] } });
  });

  bot.action('channel_schedule', async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const s = getState(ctx.from.id); if (!s || s.type !== 'channel_post_preview') return;
    setState(ctx.from.id, 'channel_post', { step: 'schedule_datetime', data: s.data });
    await ctx.answerCbQuery();
    return ctx.reply(`🕒 تاریخ و ساعت انتشار را با این قالب بفرست:\n\n<code>2026-07-20 18:30</code>\n\nزمان بر اساس UTC${env.scheduleUtcOffset} محاسبه می‌شود.`, { parse_mode: 'HTML' });
  });

  bot.action('channel_publish', async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const s = getState(ctx.from.id); if (!s || s.type !== 'channel_post_preview') return;
    const d = s.data;
    try {
      const result = await publishChannelPayload(ctx.telegram, { ...d, channelUsername: env.channelUsername });
      await ChannelPost.create({
        type: d.type,
        fileId: d.fileId || null,
        mediaFileIds: d.mediaFileIds || [],
        caption: d.caption,
        buttonRows: d.buttonRows || [],
        channelUsername: env.channelUsername,
        status: 'published',
        publishedAt: result.publishedAt,
        messageId: result.messageId,
        messageIds: result.messageIds,
        buttonMessageId: result.buttonMessageId,
        postUrl: result.postUrl,
        createdBy: ctx.from.id
      });
      clearState(ctx.from.id); await ctx.answerCbQuery();
      return ctx.reply(`✅ پست با موفقیت منتشر شد.\n\n🔗 ${result.postUrl || 'منتشر شد'}\n🧩 تعداد دکمه‌ها: ${(d.buttonRows || []).flat().length}`);
    } catch (error) {
      console.error('CHANNEL_PUBLISH_ERROR', error);
      return ctx.answerCbQuery('انتشار ناموفق بود. لاگ سرور را بررسی کن.', { show_alert: true });
    }
  });

  bot.action(/^a_scheduled_(\d+)$/, async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const page = Number(ctx.match[1]);
    const query = { status: 'scheduled' };
    const total = await ChannelPost.countDocuments(query);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(Math.max(page, 1), pages);
    const posts = await ChannelPost.find(query).sort({ scheduledAt: 1 }).skip((current - 1) * PAGE_SIZE).limit(PAGE_SIZE);
    const rows = posts.map(post => [{
      text: `🕒 ${formatScheduledAt(post.scheduledAt, scheduleOffsetMinutes())} | ${post.type}`,
      callback_data: `scheduled_view_${post._id}`
    }]);
    rows.push(paginationRow(current, pages, 'a_scheduled'));
    rows.push(adminBack[0]);
    await ctx.answerCbQuery().catch(() => {});
    return ctx.editMessageText(`🕒 <b>پست‌های زمان‌بندی‌شده</b>\n\nتعداد: ${total}`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } }).catch(() => ctx.reply(`🕒 پست‌های زمان‌بندی‌شده: ${total}`, { reply_markup: { inline_keyboard: rows } }));
  });

  bot.action(/^scheduled_view_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const post = await ChannelPost.findById(ctx.match[1]);
    if (!post || post.status !== 'scheduled') return ctx.answerCbQuery('این پست دیگر در صف زمان‌بندی نیست.', { show_alert: true });
    await ctx.answerCbQuery();
    return ctx.editMessageText(`🕒 <b>پست زمان‌بندی‌شده</b>\n\nنوع: ${post.type}\nزمان: <code>${formatScheduledAt(post.scheduledAt, scheduleOffsetMinutes())}</code>\nدکمه‌ها: ${(post.buttonRows || []).flat().length}\n\n${post.caption.slice(0, 500)}`, { parse_mode: 'HTML', reply_markup: scheduledPostKeyboard(post) });
  });

  bot.action(/^scheduled_publish_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const post = await ChannelPost.findById(ctx.match[1]);
    if (!post || !['scheduled', 'failed'].includes(post.status)) return ctx.answerCbQuery('این پست قابل انتشار نیست.', { show_alert: true });
    post.status = 'publishing'; await post.save();
    try {
      await publishStoredChannelPost(ctx.telegram, post);
      await ctx.answerCbQuery('منتشر شد.');
      return ctx.editMessageText(`✅ پست منتشر شد.\n\n${post.postUrl || ''}`, { reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به زمان‌بندی‌ها', callback_data: 'a_scheduled_1' }], adminBack[0]] } });
    } catch (error) {
      console.error('SCHEDULED_FORCE_PUBLISH_ERROR', error);
      return ctx.answerCbQuery('انتشار ناموفق بود.', { show_alert: true });
    }
  });

  bot.action(/^scheduled_reschedule_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const post = await ChannelPost.findById(ctx.match[1]);
    if (!post || post.status !== 'scheduled') return ctx.answerCbQuery('پست پیدا نشد.', { show_alert: true });
    setState(ctx.from.id, 'channel_reschedule', { postId: String(post._id) });
    await ctx.answerCbQuery();
    return ctx.reply(`🕒 زمان جدید را بفرست.\nمثال: <code>2026-07-20 21:00</code>\nUTC${env.scheduleUtcOffset}`, { parse_mode: 'HTML' });
  });

  bot.action(/^scheduled_cancel_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const post = await ChannelPost.findById(ctx.match[1]);
    if (!post || post.status !== 'scheduled') return ctx.answerCbQuery('این پست دیگر زمان‌بندی‌شده نیست.', { show_alert: true });
    await ctx.answerCbQuery();
    return ctx.editMessageText('⚠️ زمان‌بندی این پست لغو شود؟ خود رکورد برای تاریخچه باقی می‌ماند.', { reply_markup: { inline_keyboard: [
      [{ text: '✅ بله، لغو شود', callback_data: `scheduled_cancel_confirm_${post._id}`, style: 'danger' }],
      [{ text: '❌ انصراف', callback_data: `scheduled_view_${post._id}` }]
    ] } });
  });

  bot.action(/^scheduled_cancel_confirm_([a-f0-9]{24})$/, async ctx => {
    if (!(await guard(ctx, 'channelPosts'))) return;
    const post = await ChannelPost.findOneAndUpdate({ _id: ctx.match[1], status: 'scheduled' }, { status: 'cancelled' }, { new: true });
    if (!post) return ctx.answerCbQuery('پست پیدا نشد یا قبلاً تغییر کرده.', { show_alert: true });
    await ctx.answerCbQuery('زمان‌بندی لغو شد.');
    return ctx.editMessageText('✅ زمان‌بندی پست لغو شد.', { reply_markup: { inline_keyboard: [[{ text: '🔙 بازگشت به زمان‌بندی‌ها', callback_data: 'a_scheduled_1' }], adminBack[0]] } });
  });

  async function skipPromptStep(ctx, expectedStep, nextStep, mutate, replyText, extra = {}) {
    if (!(await guard(ctx, 'prompts'))) return;
    const state = getState(ctx.from.id);
    if (!state || state.type !== 'admin_prompt' || state.data?.step !== expectedStep) {
      return ctx.answerCbQuery('این مرحله دیگر فعال نیست.', { show_alert: true });
    }
    const flow = state.data;
    const draft = flow.data || (flow.data = {});
    mutate(draft);
    flow.step = nextStep;
    setState(ctx.from.id, 'admin_prompt', flow);
    await ctx.answerCbQuery('این مرحله رد شد.');
    return ctx.reply(replyText, extra);
  }

  bot.action('prompt_skip_tip', ctx => skipPromptStep(
    ctx,
    'tip',
    'tools',
    draft => { draft.usageTip = null; },
    `🧪 ابزارهای تست‌شده را با ویرگول بنویس.\nمثال: <code>Gemini, ChatGPT</code>`,
    { parse_mode: 'HTML' }
  ));

  bot.action('prompt_skip_post', ctx => skipPromptStep(
    ctx,
    'post',
    'image',
    draft => { draft.channelPostUrl = null; },
    `🖼 <b>تصویر نمونه</b>\n\nیک تصویر بفرست تا همراه پرامپت نمایش داده شود.`,
    { parse_mode: 'HTML', reply_markup: promptSkipKeyboard('image') }
  ));

  bot.action('prompt_skip_image', async ctx => {
    if (!(await guard(ctx, 'prompts'))) return;
    const state = getState(ctx.from.id);
    if (!state || state.type !== 'admin_prompt' || state.data?.step !== 'image') {
      return ctx.answerCbQuery('این مرحله دیگر فعال نیست.', { show_alert: true });
    }
    const flow = state.data;
    const draft = flow.data || (flow.data = {});
    draft.imageFileId = null;
    flow.step = 'confirm';
    setState(ctx.from.id, 'admin_prompt', flow);
    await ctx.answerCbQuery('بدون تصویر ادامه می‌دهیم.');
    return ctx.reply(promptPreview(draft), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ تأیید و ثبت', callback_data: 'prompt_confirm', style: 'success' }],
          [{ text: '❌ لغو', callback_data: 'cancel_input', style: 'danger' }]
        ]
      }
    });
  });

  bot.action(/^support_reply_(.+)$/,async ctx=>{if(!isOwner(ctx.from.id))return;setState(ctx.from.id,'support_reply',{ticketId:ctx.match[1]});await ctx.answerCbQuery();return ctx.reply('پاسخ را بنویس.');});

  bot.on('message', async (ctx,next)=>{
    if(!(await isAdmin(ctx.from.id)))return next(); const state=getState(ctx.from.id); if(!state)return next(); const text=ctx.message.text?.trim();
    if(text?.startsWith('/')){clearState(ctx.from.id);return next();}
    if (state.type === 'admin_prompt') {
      const flow = state.data;
      const draft = flow.data || (flow.data = {});
      const step = flow.step;

      if (step === 'title') {
        if (!text) return ctx.reply('عنوان را به‌صورت متن بفرست.');
        if (text !== 'همان') draft.title = text;
        flow.step = 'slug';
        setState(ctx.from.id, 'admin_prompt', flow);
        return ctx.reply('🔗 اسلاگ انگلیسی را بفرست.\nمثال: <code>summer-girl</code>', { parse_mode: 'HTML' });
      }

      if (step === 'slug') {
        if (!text) return ctx.reply('اسلاگ را به‌صورت متن بفرست.');
        if (text !== 'همان') {
          draft.slug = text.toLowerCase().trim().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '');
          if (!draft.slug) return ctx.reply('اسلاگ معتبر نیست. فقط حروف انگلیسی، عدد، خط تیره و زیرخط استفاده کن.');
        }
        flow.step = 'text';
        setState(ctx.from.id, 'admin_prompt', flow);
        return ctx.reply('📝 متن کامل پرامپت را بفرست.');
      }

      if (step === 'text') {
        if (!text) return ctx.reply('متن پرامپت را به‌صورت پیام متنی بفرست.');
        if (text !== 'همان') draft.promptText = text;
        flow.step = 'tip';
        setState(ctx.from.id, 'admin_prompt', flow);
        return ctx.reply('💡 نکته استفاده بهتر را بنویس.\nمثال: «نام Sara را با نام دلخواهت جایگزین کن.»', { reply_markup: promptSkipKeyboard('tip') });
      }

      if (step === 'tip') {
        if (!text) return ctx.reply('نکته را به‌صورت متن بفرست یا «ندارد» بنویس.');
        if (text !== 'همان') draft.usageTip = text === 'ندارد' ? null : text;
        flow.step = 'tools';
        setState(ctx.from.id, 'admin_prompt', flow);
        return ctx.reply('🧪 ابزارهای تست‌شده را با ویرگول بنویس.\nمثال: <code>Gemini, ChatGPT</code>', { parse_mode: 'HTML' });
      }

      if (step === 'tools') {
        if (!text) return ctx.reply('نام ابزارها را به‌صورت متن بفرست.');
        if (text !== 'همان') draft.tools = text.split(/[,،]/).map(x => x.trim()).filter(Boolean);
        flow.step = 'post';
        setState(ctx.from.id, 'admin_prompt', flow);
        return ctx.reply('🔗 <b>لینک پست اصلی کانال</b>\n\nاگر این پرامپت قبلاً در کانال منتشر شده، لینک همان پست را بفرست.\nمثال: <code>https://t.me/SiniorAi/125</code>', { parse_mode: 'HTML', reply_markup: promptSkipKeyboard('post') });
      }

      if (step === 'post') {
        if (!text) return ctx.reply('لینک را بفرست یا «ندارد» بنویس.');
        if (text !== 'همان') {
          if (text !== 'ندارد' && !/^https:\/\/t\.me\//i.test(text)) {
            return ctx.reply('لینک معتبر تلگرام بفرست؛ مثال: https://t.me/SiniorAi/125 یا «ندارد».');
          }
          draft.channelPostUrl = text === 'ندارد' ? null : text;
        }
        flow.step = 'image';
        setState(ctx.from.id, 'admin_prompt', flow);
        return ctx.reply('🖼 <b>تصویر نمونه</b>\n\nیک تصویر بفرست تا همراه پرامپت نمایش داده شود.', { parse_mode: 'HTML', reply_markup: promptSkipKeyboard('image') });
      }

      if (step === 'image') {
        if (ctx.message.photo?.length) {
          draft.imageFileId = ctx.message.photo.at(-1).file_id;
        } else if (text === 'بدون تصویر') {
          draft.imageFileId = null;
        } else if (text !== 'همان') {
          return ctx.reply('یک تصویر بفرست یا «بدون تصویر» بنویس.');
        }

        flow.step = 'confirm';
        setState(ctx.from.id, 'admin_prompt', flow);
        return ctx.reply(promptPreview(draft), {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ تأیید و ثبت', callback_data: 'prompt_confirm', style: 'success' }],
              [{ text: '❌ لغو', callback_data: 'cancel_input', style: 'danger' }]
            ]
          }
        });
      }

      if (step === 'confirm') {
        return ctx.reply('پیش‌نمایش آماده است؛ از دکمه‌های زیر پیام قبلی استفاده کن.');
      }
    }
    if(state.type==='admin_lesson'){const d=state.data;if(d.step==='title'){if(text!=='همان')d.data.title=text;d.step='content';return ctx.reply('متن آموزش را بفرست.');}if(d.step==='content'){if(text!=='همان')d.data.content=text;if(d.mode==='edit')await AiLesson.findByIdAndUpdate(d.id,d.data);else await AiLesson.create({...d.data,createdBy:ctx.from.id,order:await AiLesson.countDocuments()+1});clearState(ctx.from.id);return ctx.reply('✅ آموزش ذخیره شد.',{reply_markup:{inline_keyboard:[[{text:'🎓 بازگشت به مدیریت آموزش‌ها',callback_data:'a_lessons_1'}],adminBack[0]]}});}}
    if(state.type==='request_edit'){await PromptRequest.findByIdAndUpdate(state.data.id,{text});clearState(ctx.from.id);return ctx.reply('✅ ویرایش شد.');}
    if(state.type==='admin_code'){const d=state.data;if(d.step==='title'){d.data.title=text;d.step='code';return ctx.reply('کد را بفرست. مثال: SUMMER50');}if(d.step==='code'){d.data.code=text.toUpperCase();d.step='type';return ctx.reply('نوع را بفرست: percent یا fixed');}if(d.step==='type'){d.data.type=text==='fixed'?'fixed':'percent';d.step='value';return ctx.reply('مقدار تخفیف؟');}if(d.step==='value'){d.data.value=Number(text);d.step='days';return ctx.reply('چند روز اعتبار دارد؟');}if(d.step==='days'){d.data.expiresAt=new Date(Date.now()+Number(text)*86400000);d.step='max';return ctx.reply('حداکثر استفاده کلی؟');}if(d.step==='max'){d.data.maxUses=Number(text);d.step='confirm';return ctx.reply(`👁 پیش‌نمایش\nعنوان: ${d.data.title}\nکد: ${d.data.code}\nمقدار: ${d.data.value}\nسقف: ${d.data.maxUses}\nانقضا: ${formatDateTime(d.data.expiresAt)}`,{reply_markup:{inline_keyboard:[[{text:'✅ ساخت کد',callback_data:'code_confirm',style:'success'},{text:'❌ لغو',callback_data:'cancel_input',style:'danger'}]]}});}}
    if(state.type==='admin_add'){const d=state.data;if(d.step==='id'){const id=Number(text);if(!id)return ctx.reply('آیدی عددی معتبر بفرست.');d.data.telegramId=id;d.step='perms';return ctx.reply('مجوزها را با ویرگول بنویس. مثال: prompts,lessons یا all');}if(d.step==='perms'){const names=['prompts','lessons','payments','users','discounts','broadcast','support','channelPosts','requests','results'];const selected=text.toLowerCase()==='all'?names:text.split(',').map(x=>x.trim()).filter(x=>names.includes(x));const permissions=Object.fromEntries(names.map(n=>[n,selected.includes(n)]));await Admin.findOneAndUpdate({telegramId:d.data.telegramId},{telegramId:d.data.telegramId,title:'ادمین',permissions,isActive:true,createdBy:ctx.from.id},{upsert:true,new:true});clearState(ctx.from.id);return ctx.reply('✅ ادمین و سطح دسترسی ذخیره شد.');}}
    if(state.type==='admin_edit_perms'){const names=['prompts','lessons','payments','users','discounts','broadcast','support','channelPosts','requests','results'];const selected=text.toLowerCase()==='all'?names:text.split(',').map(x=>x.trim()).filter(x=>names.includes(x));const permissions=Object.fromEntries(names.map(n=>[n,selected.includes(n)]));await Admin.findByIdAndUpdate(state.data.id,{permissions});clearState(ctx.from.id);return ctx.reply('✅ مجوزهای ادمین به‌روزرسانی شد.');}
    if(state.type==='broadcast'){setState(ctx.from.id,'broadcast_preview',{chatId:ctx.chat.id,messageId:ctx.message.message_id});return ctx.reply('👁 پیش‌نمایش بالا. برای همه ارسال شود؟',{reply_markup:{inline_keyboard:[[{text:'✅ ارسال همگانی',callback_data:'broadcast_confirm',style:'success'},{text:'❌ لغو',callback_data:'cancel_input',style:'danger'}]]}});}
    if (state.type === 'channel_post') {
      const flow = state.data;
      const data = flow.data || (flow.data = {});
      const step = flow.step;

      if (step === 'album_media') {
        if (!ctx.message.photo) return ctx.reply('فقط عکس بفرست. برای پایان، دکمه «پایان انتخاب تصاویر» را بزن.');
        data.mediaFileIds ||= [];
        if (data.mediaFileIds.length >= 10) return ctx.reply('حداکثر ۱۰ عکس ثبت شده است. حالا «پایان انتخاب تصاویر» را بزن.');
        data.mediaFileIds.push(ctx.message.photo.at(-1).file_id);
        setState(ctx.from.id, 'channel_post', flow);
        return ctx.reply(`✅ عکس ثبت شد: ${data.mediaFileIds.length}/10`, { reply_markup: { inline_keyboard: [
          [{ text: '✅ پایان انتخاب تصاویر', callback_data: 'channel_album_done', style: 'success' }],
          [{ text: '🗑 حذف آخرین عکس', callback_data: 'channel_album_remove_last' }],
          [{ text: '❌ لغو', callback_data: 'cancel_input', style: 'danger' }]
        ] } });
      }

      if (step === 'media') {
        if (data.type === 'photo' && !ctx.message.photo) return ctx.reply('عکس بفرست.');
        if (data.type === 'video' && !ctx.message.video) return ctx.reply('ویدیو بفرست.');
        data.fileId = ctx.message.photo?.at(-1)?.file_id || ctx.message.video?.file_id;
        flow.step = 'caption';
        setState(ctx.from.id, 'channel_post', flow);
        return ctx.reply('📝 کپشن نهایی را بفرست. می‌توانی از HTML ساده مثل <b>Bold</b> استفاده کنی.');
      }

      if (step === 'caption') {
        data.caption = text || ctx.message.caption || '';
        if (!data.caption) return ctx.reply('متن یا کپشن پست را بفرست.');
        setState(ctx.from.id, 'channel_post_builder', data);
        return ctx.reply('✅ محتوای اصلی پست ثبت شد. حالا می‌توانی چند دکمه لینک‌دار اضافه کنی یا مستقیم پیش‌نمایش را ببینی.', { reply_markup: channelBuilderKeyboard(data) });
      }

      if (step === 'schedule_datetime') {
        const scheduledAt = parseScheduleInput(text, scheduleOffsetMinutes());
        if (!scheduledAt) return ctx.reply('فرمت تاریخ درست نیست. مثال: 2026-07-20 18:30');
        if (scheduledAt <= new Date()) return ctx.reply('زمان انتشار باید در آینده باشد.');
        const post = await ChannelPost.create({
          type: data.type,
          fileId: data.fileId || null,
          mediaFileIds: data.mediaFileIds || [],
          caption: data.caption,
          buttonRows: data.buttonRows || [],
          channelUsername: env.channelUsername,
          status: 'scheduled',
          scheduledAt,
          createdBy: ctx.from.id
        });
        clearState(ctx.from.id);
        return ctx.reply(`✅ پست زمان‌بندی شد.

🕒 زمان انتشار: ${formatScheduledAt(post.scheduledAt, scheduleOffsetMinutes())}
📌 شناسه: ${post._id}`, { reply_markup: { inline_keyboard: [[{ text: '🕒 مدیریت زمان‌بندی‌ها', callback_data: 'a_scheduled_1' }], adminBack[0]] } });
      }

      if (step === 'button_text') {
        if (!text) return ctx.reply('متن دکمه را به‌صورت پیام متنی بفرست.');
        data.pendingButton = { text, url: null };
        flow.step = 'button_url';
        setState(ctx.from.id, 'channel_post', flow);
        return ctx.reply('🔗 لینک دکمه را بفرست.\nمثال: https://t.me/SiniorAiBot?start=prompt_summer-girl');
      }

      if (step === 'button_url') {
        if (!validButtonUrl(text)) return ctx.reply('لینک معتبر نیست. یک لینک با http:// یا https:// یا tg:// بفرست.');
        data.pendingButton.url = text;
        setState(ctx.from.id, 'channel_post_place', data);
        const canSame = data.buttonRows?.length && data.buttonRows.at(-1).length < 2;
        return ctx.reply('چیدمان این دکمه را انتخاب کن.', { reply_markup: { inline_keyboard: [[{ text: '⬇️ ردیف جدید', callback_data: 'channel_place_new' }], ...(canSame ? [[{ text: '↔️ کنار دکمه قبلی', callback_data: 'channel_place_same' }]] : [])] } });
      }

      if (step === 'prompt_button_text') {
        if (text && text !== 'خودکار') data.pendingButton.text = text;
        setState(ctx.from.id, 'channel_post_place', data);
        const canSame = data.buttonRows?.length && data.buttonRows.at(-1).length < 2;
        return ctx.reply('چیدمان این دکمه را انتخاب کن.', { reply_markup: { inline_keyboard: [[{ text: '⬇️ ردیف جدید', callback_data: 'channel_place_new' }], ...(canSame ? [[{ text: '↔️ کنار دکمه قبلی', callback_data: 'channel_place_same' }]] : [])] } });
      }
    }

    if (state.type === 'channel_reschedule') {
      const scheduledAt = parseScheduleInput(text, scheduleOffsetMinutes());
      if (!scheduledAt) return ctx.reply('فرمت تاریخ درست نیست. مثال: 2026-07-20 21:00');
      if (scheduledAt <= new Date()) return ctx.reply('زمان جدید باید در آینده باشد.');
      const post = await ChannelPost.findOneAndUpdate(
        { _id: state.data.postId, status: 'scheduled' },
        { scheduledAt },
        { new: true }
      );
      clearState(ctx.from.id);
      if (!post) return ctx.reply('پست پیدا نشد یا وضعیتش تغییر کرده است.');
      return ctx.reply(`✅ زمان انتشار تغییر کرد.
🕒 ${formatScheduledAt(post.scheduledAt, scheduleOffsetMinutes())}`, { reply_markup: { inline_keyboard: [[{ text: '🕒 بازگشت به زمان‌بندی‌ها', callback_data: 'a_scheduled_1' }], adminBack[0]] } });
    }
    if(state.type==='support_reply'){const ticket=await SupportTicket.findById(state.data.ticketId);if(!ticket)return;await ctx.telegram.sendMessage(ticket.userTelegramId,`💬 پاسخ پشتیبانی Sinior Ai:\n\n${text}`).catch(()=>{});ticket.status='answered';ticket.answeredBy=ctx.from.id;ticket.answeredAt=new Date();ticket.answerText=text;await ticket.save();clearState(ctx.from.id);return ctx.reply('✅ پاسخ ارسال شد.');}
    return next();
  });

  bot.action('prompt_confirm', async ctx => {
    if (!(await guard(ctx, 'prompts'))) return;
    const state = getState(ctx.from.id);
    if (!state || state.type !== 'admin_prompt') {
      return ctx.answerCbQuery('فرایند افزودن پرامپت منقضی شده است.', { show_alert: true });
    }

    const flow = state.data;
    const draft = flow.data || {};
    if (!draft.title || !draft.slug || !draft.promptText) {
      return ctx.answerCbQuery('اطلاعات اصلی پرامپت ناقص است.', { show_alert: true });
    }

    try {
      let prompt;
      if (flow.mode === 'edit') {
        prompt = await Prompt.findByIdAndUpdate(flow.promptId, draft, { new: true, runValidators: true });
      } else {
        const duplicate = await Prompt.findOne({ slug: draft.slug });
        if (duplicate) {
          const message = duplicate.isDeleted
            ? 'این اسلاگ متعلق به یک پرامپت آرشیوشده است. آن را بازیابی یا حذف دائم کن تا اسلاگ آزاد شود.'
            : 'این اسلاگ قبلاً توسط یک پرامپت فعال استفاده شده است.';
          return ctx.answerCbQuery(message, { show_alert: true });
        }
        prompt = await Prompt.create({ ...draft, createdBy: ctx.from.id });
      }

      clearState(ctx.from.id);
      await audit(ctx.from.id, flow.mode === 'edit' ? 'prompt_edit' : 'prompt_create', 'Prompt', prompt._id);
      await ctx.answerCbQuery('ثبت شد.');
      return ctx.reply(
        `✅ <b>پرامپت با موفقیت ذخیره شد</b>\n\n🔗 لینک دریافت:\n<code>https://t.me/${env.botUsername}?start=prompt_${prompt.slug}</code>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🛠 بازگشت به پنل', callback_data: 'admin_home' }]] } }
      );
    } catch (error) {
      console.error('Prompt confirm error:', error);
      return ctx.answerCbQuery('ثبت پرامپت ناموفق بود. لاگ سرور را بررسی کن.', { show_alert: true });
    }
  });
  bot.action('code_confirm',async ctx=>{if(!(await guard(ctx,'discounts')))return;const state=getState(ctx.from.id);if(!state||state.type!=='admin_code')return;await DiscountCode.create({...state.data.data,createdBy:ctx.from.id});clearState(ctx.from.id);await ctx.answerCbQuery('ساخته شد.');return showAdmin(ctx);});

  bot.action(/^a_user_(\d+)$/,async ctx=>{if(!(await guard(ctx,'users')))return;await ctx.answerCbQuery();const u=await User.findOne({telegramId:Number(ctx.match[1])});if(!u)return;return ctx.editMessageText(`👤 ${escapeHtml(u.firstName||'کاربر')} ${u.username?`(@${escapeHtml(u.username)})`:''}\n🆔 <code>${u.telegramId}</code>\nپلن: ${u.plan}\nکیف پول: ${formatToman(u.walletBalance)}\nVIP تا: ${u.vipUntil?formatDateTime(u.vipUntil):'-'}`,{parse_mode:'HTML',reply_markup:{inline_keyboard:adminBack}});});
  bot.action(/^a_history_(\d+)$/,async ctx=>{if(!(await guard(ctx,'payments')))return;await ctx.answerCbQuery();const rows=await Payment.find({userTelegramId:Number(ctx.match[1])}).sort({createdAt:-1}).limit(20);return ctx.reply(rows.map(p=>`${p.paymentCode} | ${p.status} | ${formatToman(p.finalPrice)} | ${formatDateTime(p.createdAt)}`).join('\n')||'تاریخچه‌ای نیست.');});

  bot.action(/^a_users_(\d+)$/,ctx=>listGeneric(ctx,User,{},Number(ctx.match[1]),'a_users',u=>[{text:`👤 ${u.firstName||u.telegramId} ${u.plan==='vip'?'👑':''}`,callback_data:`a_user_${u.telegramId}`}],'users'));
}

module.exports = { registerAdminHandlers };
