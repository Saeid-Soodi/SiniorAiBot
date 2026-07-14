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

const PAGE_SIZE = 8;
const adminBack = [[{ text: '🔙 بازگشت', callback_data: 'admin_home' }, { text: '🏠 منوی اصلی پنل', callback_data: 'admin_home' }]];

async function guard(ctx, permission = null) {
  if (!(await isAdmin(ctx.from.id))) { await ctx.answerCbQuery?.('دسترسی ندارید.', { show_alert: true }).catch(() => {}); return false; }
  if (permission && !(await can(ctx.from.id, permission))) { await ctx.answerCbQuery?.('مجوز این بخش را ندارید.', { show_alert: true }).catch(() => {}); return false; }
  return true;
}

function adminMenu() {
  return { inline_keyboard: [
    [{ text: '➕ افزودن پرامپت', callback_data: 'a_prompt_add' }, { text: '📚 مدیریت پرامپت‌ها', callback_data: 'a_prompts_1' }],
    [{ text: '🎓 آموزش‌ها', callback_data: 'a_lessons_1' }, { text: '📝 درخواست‌ها', callback_data: 'a_requests_1' }],
    [{ text: '💳 پرداخت‌ها', callback_data: 'a_payments_1' }, { text: '👥 کاربران', callback_data: 'a_users_1' }],
    [{ text: '🎟 کدهای تخفیف', callback_data: 'a_codes_1' }, { text: '📢 پیام همگانی', callback_data: 'a_broadcast' }],
    [{ text: '📣 ارسال پست کانال', callback_data: 'a_channel_post' }, { text: '🛡 مدیریت ادمین‌ها', callback_data: 'a_admins' }]
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
  if (replyMarkup) extra.reply_markup = replyMarkup;
  if (data.type === 'photo') return ctx.replyWithPhoto(data.fileId, { caption: data.caption, ...extra });
  if (data.type === 'video') return ctx.replyWithVideo(data.fileId, { caption: data.caption, ...extra });
  return ctx.reply(data.caption, extra);
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

  bot.action('a_prompt_add', async ctx => { if (!(await guard(ctx,'prompts'))) return; await ctx.answerCbQuery(); setState(ctx.from.id, 'admin_prompt', { step: 'title', data: {} }); return ctx.reply('➕ <b>افزودن پرامپت</b>\n\nعنوان نمایشی را بفرست.\nمثال: دختر تابستانی در ساحل', { parse_mode: 'HTML', reply_markup: { inline_keyboard: adminBack } }); });
  bot.action(/^a_prompts_(\d+)$/, ctx => listGeneric(ctx, Prompt, {}, Number(ctx.match[1]), 'a_prompts', p => [{ text: `✨ ${p.title}`, callback_data: `a_prompt_${p._id}` }], 'prompts'));
  bot.action(/^a_prompt_([a-f0-9]{24})$/, async ctx => { if (!(await guard(ctx,'prompts'))) return; await ctx.answerCbQuery(); const p = await Prompt.findById(ctx.match[1]); if (!p) return; return ctx.editMessageText(promptPreview(p), { parse_mode:'HTML', reply_markup:{ inline_keyboard:[[{text:'✏️ ویرایش',callback_data:`a_prompt_edit_${p._id}`},{text:'🗑 حذف',callback_data:`a_prompt_del_${p._id}`,style:'danger'}],[{text:'🔗 لینک دریافت',url:`https://t.me/${env.botUsername}?start=prompt_${p.slug}`}],adminBack[0]] } }).catch(()=>{}); });
  bot.action(/^a_prompt_edit_(.+)$/, async ctx => { if (!(await guard(ctx,'prompts'))) return; await ctx.answerCbQuery(); const p=await Prompt.findById(ctx.match[1]); setState(ctx.from.id,'admin_prompt',{step:'title',mode:'edit',promptId:p._id,data:p.toObject()}); return ctx.reply('ویرایش شروع شد. عنوان را بفرست یا «همان» بنویس.',{reply_markup:{inline_keyboard:adminBack}}); });
  bot.action(/^a_prompt_del_(.+)$/, async ctx => { if (!(await guard(ctx,'prompts'))) return; await Prompt.findByIdAndUpdate(ctx.match[1],{isActive:false}); await audit(ctx.from.id,'prompt_soft_delete','Prompt',ctx.match[1]); await ctx.answerCbQuery('غیرفعال شد.'); return showAdmin(ctx); });

  bot.action(/^a_lessons_(\d+)$/, async ctx => {
    if (!(await guard(ctx,'lessons'))) return;
    const page=Number(ctx.match[1]); const total=await AiLesson.countDocuments(); const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
    const items=await AiLesson.find().sort({order:1,createdAt:-1}).skip((page-1)*PAGE_SIZE).limit(PAGE_SIZE);
    const rows=[[{text:'➕ افزودن آموزش',callback_data:'a_lesson_add',style:'success'}],...items.map(l=>[{text:`🎓 ${l.title}`,callback_data:`a_lesson_${l._id}`}]),paginationRow(page,pages,'a_lessons'),adminBack[0]];
    await ctx.answerCbQuery().catch(()=>{}); return ctx.editMessageText(`🎓 مدیریت آموزش‌ها | ${total} مورد`,{reply_markup:{inline_keyboard:rows}}).catch(()=>ctx.reply('🎓 مدیریت آموزش‌ها',{reply_markup:{inline_keyboard:rows}}));
  });
  bot.action(/^a_lesson_([a-f0-9]{24})$/, async ctx => { if (!(await guard(ctx,'lessons'))) return; await ctx.answerCbQuery(); const l=await AiLesson.findById(ctx.match[1]); if(!l)return; return ctx.editMessageText(`🎓 <b>${escapeHtml(l.title)}</b>\n\n${escapeHtml(l.content)}`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✏️ ویرایش',callback_data:`a_lesson_edit_${l._id}`},{text:'🗑 حذف',callback_data:`a_lesson_del_${l._id}`,style:'danger'}],adminBack[0]]}}); });
  bot.action(/^a_lesson_edit_(.+)$/, async ctx=>{ if(!(await guard(ctx,'lessons')))return; const l=await AiLesson.findById(ctx.match[1]); setState(ctx.from.id,'admin_lesson',{step:'title',mode:'edit',id:l._id,data:l.toObject()}); await ctx.answerCbQuery(); return ctx.reply('عنوان جدید را بفرست یا «همان» بنویس.'); });
  bot.action(/^a_lesson_del_(.+)$/, async ctx=>{ if(!(await guard(ctx,'lessons')))return; await AiLesson.findByIdAndDelete(ctx.match[1]); await ctx.answerCbQuery('حذف شد.'); return showAdmin(ctx); });
  bot.action('a_lesson_add', async ctx=>{ if(!(await guard(ctx,'lessons')))return; setState(ctx.from.id,'admin_lesson',{step:'title',data:{}}); await ctx.answerCbQuery(); return ctx.reply('عنوان آموزش را بفرست.'); });

  bot.action(/^a_requests_(\d+)$/, ctx => listGeneric(ctx, PromptRequest, {}, Number(ctx.match[1]), 'a_requests', r => [{text:`${r.status==='approved'?'✅':r.status==='rejected'?'❌':'⏳'} ${String(r.text).slice(0,35)}`,callback_data:`a_request_${r._id}`}], 'requests'));
  bot.action(/^a_request_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'requests')))return; await ctx.answerCbQuery(); const r=await PromptRequest.findById(ctx.match[1]); if(!r)return; return ctx.editMessageText(`📝 <b>درخواست</b>\n\n${escapeHtml(r.text)}\n\nوضعیت: ${r.status}\nتاریخ: ${formatDateTime(r.createdAt)}`,{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'✅ تأیید',callback_data:`req_approve_${r._id}`,style:'success'},{text:'❌ رد',callback_data:`req_reject_${r._id}`,style:'danger'}],[{text:'✏️ ویرایش متن',callback_data:`req_edit_${r._id}`},{text:'🗑 حذف',callback_data:`req_delete_${r._id}`}],adminBack[0]]}}); });
  bot.action(/^req_(approve|reject)_(.+)$/, async ctx=>{ if(!(await guard(ctx,'requests')))return; const status=ctx.match[1]==='approve'?'approved':'rejected'; await PromptRequest.findByIdAndUpdate(ctx.match[2],{status,reviewedBy:ctx.from.id,reviewedAt:new Date()}); await ctx.answerCbQuery('ثبت شد.'); return showAdmin(ctx); });
  bot.action(/^req_delete_(.+)$/, async ctx=>{ if(!(await guard(ctx,'requests')))return; await PromptRequest.findByIdAndDelete(ctx.match[1]); await ctx.answerCbQuery('حذف شد.'); return showAdmin(ctx); });
  bot.action(/^req_edit_(.+)$/, async ctx=>{ if(!(await guard(ctx,'requests')))return; setState(ctx.from.id,'request_edit',{id:ctx.match[1]}); await ctx.answerCbQuery(); return ctx.reply('متن جدید درخواست را بفرست.'); });

  bot.action(/^a_payments_(\d+)$/, ctx => listGeneric(ctx, Payment, {}, Number(ctx.match[1]), 'a_payments', p => [{text:`${p.status==='approved'?'✅':p.status==='rejected'?'❌':'⏳'} ${p.paymentCode} | ${formatToman(p.finalPrice)}`,callback_data:`a_payment_${p._id}`}], 'payments'));
  bot.action(/^a_payment_([a-f0-9]{24})$/, async ctx=>{ if(!(await guard(ctx,'payments')))return; await ctx.answerCbQuery(); const p=await Payment.findById(ctx.match[1]); const u=await User.findOne({telegramId:p.userTelegramId}); return ctx.editMessageText(`💳 <b>${p.paymentCode}</b>\n\n👤 ${escapeHtml(u?.firstName||'کاربر')} ${u?.username?`(@${escapeHtml(u.username)})`:''}\n🆔 <code>${p.userTelegramId}</code>\nنوع: ${p.type}\nمبلغ: ${formatToman(p.finalPrice)}\nتاریخ: ${formatDateTime(p.createdAt)}\nوضعیت: ${p.status}`,{parse_mode:'HTML',reply_markup:{inline_keyboard:adminBack}}); });

  bot.action(/^pay_approve_(.+)$/, async ctx => { if (!(await guard(ctx,'payments'))) return; await ctx.answerCbQuery(); const p=await Payment.findById(ctx.match[1]); if(!p||p.status!=='pending')return;
    p.status='approved';p.reviewedBy=ctx.from.id;p.reviewedAt=new Date();await p.save(); let message='✅ پرداخت تأیید شد.';
    if(p.type==='wallet_topup'){ await creditWallet(p.userTelegramId,p.finalPrice,{referenceId:p._id,createdBy:ctx.from.id}); message=`✅ کیف پولت ${formatToman(p.finalPrice)} شارژ شد.`; }
    else if(p.type==='gift_purchase'){ const gift=await createGift({buyerTelegramId:p.userTelegramId,paymentId:p._id,vipDays:env.vipDays}); const link=`https://t.me/${env.botUsername}?start=gift_${gift.code}`; message=`🎁 پرداخت هدیه تأیید شد. لینک یک‌بارمصرف هدیه:\n${link}`; }
    else { const user=await activateOrExtendVip(p.userTelegramId,env.vipDays); message=`👑 پرداخت تأیید شد. VIP تا ${user.vipUntil.toLocaleDateString('fa-IR')} فعال است.`; }
    await consumeCode(p.discountCode,p.userTelegramId); await ctx.telegram.sendMessage(p.userTelegramId,message).catch(()=>{}); await audit(ctx.from.id,'payment_approve','Payment',p._id,{type:p.type}); return ctx.editMessageCaption(`✅ پرداخت تأیید شد\n${p.paymentCode}\n${message}`).catch(()=>ctx.reply(message)); });
  bot.action(/^pay_reject_(.+)$/, async ctx=>{ if(!(await guard(ctx,'payments')))return; const p=await Payment.findById(ctx.match[1]); if(!p||p.status!=='pending')return; p.status='rejected';p.reviewedBy=ctx.from.id;p.reviewedAt=new Date();p.rejectionReason='رد شده توسط مدیریت';await p.save(); await ctx.telegram.sendMessage(p.userTelegramId,'❌ پرداخت تأیید نشد. برای پیگیری با پشتیبانی در ارتباط باش.').catch(()=>{}); await ctx.answerCbQuery('رد شد.'); return ctx.editMessageCaption(`❌ پرداخت رد شد\n${p.paymentCode}`).catch(()=>{}); });

  bot.action(/^result_score_(.+)_([1-9]|10)$/, async ctx=>{ if(!(await guard(ctx,'results')))return; const r=await PromptResult.findById(ctx.match[1]); if(!r)return; r.status='approved';r.adminScore=Number(ctx.match[2]);r.reviewedBy=ctx.from.id;r.reviewedAt=new Date();await r.save(); await ctx.telegram.sendMessage(r.userTelegramId,`🎉 نتیجه‌ات تأیید شد و امتیاز ${r.adminScore}/10 گرفت.`).catch(()=>{}); await ctx.answerCbQuery('تأیید شد.'); return ctx.editMessageCaption(`✅ نتیجه تأیید شد | امتیاز ${r.adminScore}/10`).catch(()=>{}); });
  bot.action(/^result_reject_(.+)$/, async ctx=>{ if(!(await guard(ctx,'results')))return; const r=await PromptResult.findByIdAndUpdate(ctx.match[1],{status:'rejected',reviewedBy:ctx.from.id,reviewedAt:new Date()},{new:true}); if(r)await ctx.telegram.sendMessage(r.userTelegramId,'❌ نتیجه ارسالی تأیید نشد.').catch(()=>{}); await ctx.answerCbQuery('رد شد.'); });

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
      ...items.map(c=>[{text:`♻️ ${c.title} | ${c.code}`,callback_data:`a_code_restore_${c._id}`}]),
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

  bot.action('a_admins',async ctx=>{if(!isOwner(ctx.from.id))return ctx.answerCbQuery('فقط مالک.');const rows=await Admin.find().sort({createdAt:-1});await ctx.answerCbQuery();const buttons=rows.map(a=>[{text:`${a.isActive?'✅':'❌'} ${a.telegramId} | ${a.title}`,callback_data:`a_admin_${a._id}`}]);buttons.unshift([{text:'➕ افزودن ادمین',callback_data:'a_admin_add',style:'success'}]);buttons.push(adminBack[0]);return ctx.editMessageText(`🛡 مدیریت ادمین‌ها\n\n${rows.length} ادمین ثبت شده.`,{reply_markup:{inline_keyboard:buttons}});});
  bot.action('a_admin_add',async ctx=>{if(!isOwner(ctx.from.id))return;setState(ctx.from.id,'admin_add',{step:'id',data:{}});await ctx.answerCbQuery();return ctx.reply('آیدی عددی ادمین را بفرست.');});
  bot.action(/^a_admin_([a-f0-9]{24})$/,async ctx=>{if(!isOwner(ctx.from.id))return;const a=await Admin.findById(ctx.match[1]);if(!a)return;await ctx.answerCbQuery();const enabled=Object.entries(a.permissions.toObject?a.permissions.toObject():a.permissions).filter(([,v])=>v).map(([k])=>k).join(', ')||'بدون دسترسی';return ctx.editMessageText(`🛡 ${a.telegramId}\nعنوان: ${a.title}\nوضعیت: ${a.isActive?'فعال':'غیرفعال'}\nمجوزها: ${enabled}`,{reply_markup:{inline_keyboard:[[{text:'✏️ تغییر مجوزها',callback_data:`a_admin_perms_${a._id}`}],[{text:a.isActive?'⏸ غیرفعال':'▶️ فعال',callback_data:`a_admin_toggle_${a._id}`}],[{text:'🗑 حذف ادمین',callback_data:`a_admin_delete_${a._id}`,style:'danger'}],adminBack[0]]}});});
  bot.action(/^a_admin_perms_([a-f0-9]{24})$/,async ctx=>{if(!isOwner(ctx.from.id))return;setState(ctx.from.id,'admin_edit_perms',{id:ctx.match[1]});await ctx.answerCbQuery();return ctx.reply('مجوزهای جدید را با ویرگول بفرست؛ مثال: prompts,lessons یا all');});
  bot.action(/^a_admin_toggle_([a-f0-9]{24})$/,async ctx=>{if(!isOwner(ctx.from.id))return;const a=await Admin.findById(ctx.match[1]);if(a){a.isActive=!a.isActive;await a.save();}await ctx.answerCbQuery('تغییر کرد.');return showAdmin(ctx);});
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

  bot.action('a_channel_post',async ctx=>{
    if(!(await guard(ctx,'channelPosts')))return;
    setState(ctx.from.id,'channel_post',{step:'type',data:{buttonRows:[]}});
    await ctx.answerCbQuery();
    return ctx.reply('📣 <b>ساخت پست حرفه‌ای کانال</b>\n\nنوع محتوا را انتخاب کن.',{parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:'🖼 تصویر',callback_data:'channel_type_photo'},{text:'🎬 ویدیو',callback_data:'channel_type_video'}],[{text:'📝 متن',callback_data:'channel_type_text'}],adminBack[0]]}});
  });
  bot.action(/^channel_type_(photo|video|text)$/,async ctx=>{
    if(!(await guard(ctx,'channelPosts')))return;
    setState(ctx.from.id,'channel_post',{step:ctx.match[1]==='text'?'caption':'media',data:{type:ctx.match[1],buttonRows:[]}});
    await ctx.answerCbQuery();
    return ctx.reply(ctx.match[1]==='text'?'📝 متن نهایی پست را بفرست. می‌توانی از HTML ساده مثل <b>Bold</b> استفاده کنی.':'📎 فایل رسانه را بفرست.');
  });
  bot.action('channel_button_add',async ctx=>{
    if(!(await guard(ctx,'channelPosts')))return;
    const s=getState(ctx.from.id); if(!s||s.type!=='channel_post_builder')return;
    setState(ctx.from.id,'channel_post',{step:'button_text',data:s.data});
    await ctx.answerCbQuery();
    return ctx.reply('📝 متن دکمه را بفرست.\nمثال: دریافت پرامپت دختر تابستانی');
  });
  bot.action(/^channel_prompt_page_(\d+)$/,async ctx=>{
    if(!(await guard(ctx,'channelPosts')))return;
    const s=getState(ctx.from.id); if(!s||!['channel_post_builder','channel_post'].includes(s.type))return;
    const page=Number(ctx.match[1]); const total=await Prompt.countDocuments({isActive:true}); const pages=Math.max(1,Math.ceil(total/PAGE_SIZE));
    const items=await Prompt.find({isActive:true}).sort({createdAt:-1}).skip((page-1)*PAGE_SIZE).limit(PAGE_SIZE);
    const rows=items.map(p=>[{text:`✨ ${p.title}`,callback_data:`channel_pick_prompt_${p._id}`}]);
    rows.push(paginationRow(page,pages,'channel_prompt_page'));
    rows.push([{text:'🔙 بازگشت به پست‌ساز',callback_data:'channel_builder'}]);
    await ctx.answerCbQuery().catch(()=>{});
    return ctx.editMessageText('🤖 یک پرامپت را انتخاب کن تا لینک دریافت آن به دکمه متصل شود.',{reply_markup:{inline_keyboard:rows}}).catch(()=>ctx.reply('🤖 یک پرامپت را انتخاب کن.',{reply_markup:{inline_keyboard:rows}}));
  });
  bot.action(/^channel_pick_prompt_([a-f0-9]{24})$/,async ctx=>{
    if(!(await guard(ctx,'channelPosts')))return;
    const current=getState(ctx.from.id); if(!current)return;
    const p=await Prompt.findById(ctx.match[1]); if(!p)return ctx.answerCbQuery('پرامپت پیدا نشد.');
    const data=current.data;
    data.pendingButton={text:`📥 دریافت ${p.title}`,url:`https://t.me/${env.botUsername}?start=prompt_${p.slug}`};
    setState(ctx.from.id,'channel_post',{step:'prompt_button_text',data});
    await ctx.answerCbQuery();
    return ctx.reply(`✅ پرامپت انتخاب شد: ${p.title}\n\nعنوان دکمه را بفرست یا «خودکار» بنویس تا این عنوان استفاده شود:\n${data.pendingButton.text}`);
  });
  bot.action('channel_place_new',async ctx=>{
    if(!(await guard(ctx,'channelPosts')))return;
    const s=getState(ctx.from.id); if(!s||s.type!=='channel_post_place')return;
    try{addChannelButton(s.data,s.data.pendingButton,'new');}catch(e){return ctx.answerCbQuery(e.message,{show_alert:true});}
    delete s.data.pendingButton; setState(ctx.from.id,'channel_post_builder',s.data); await ctx.answerCbQuery('دکمه اضافه شد.');
    return ctx.editMessageText(`✅ دکمه اضافه شد.\nتعداد دکمه‌ها: ${s.data.buttonRows.flat().length}`,{reply_markup:channelBuilderKeyboard(s.data)}).catch(()=>ctx.reply('✅ دکمه اضافه شد.',{reply_markup:channelBuilderKeyboard(s.data)}));
  });
  bot.action('channel_place_same',async ctx=>{
    if(!(await guard(ctx,'channelPosts')))return;
    const s=getState(ctx.from.id); if(!s||s.type!=='channel_post_place')return;
    try{addChannelButton(s.data,s.data.pendingButton,'same');}catch(e){return ctx.answerCbQuery(e.message,{show_alert:true});}
    delete s.data.pendingButton; setState(ctx.from.id,'channel_post_builder',s.data); await ctx.answerCbQuery('دکمه اضافه شد.');
    return ctx.editMessageText(`✅ دکمه اضافه شد.\nتعداد دکمه‌ها: ${s.data.buttonRows.flat().length}`,{reply_markup:channelBuilderKeyboard(s.data)}).catch(()=>ctx.reply('✅ دکمه اضافه شد.',{reply_markup:channelBuilderKeyboard(s.data)}));
  });
  bot.action('channel_builder',async ctx=>{
    if(!(await guard(ctx,'channelPosts')))return;
    const s=getState(ctx.from.id); if(!s)return;
    setState(ctx.from.id,'channel_post_builder',s.data);
    await ctx.answerCbQuery().catch(()=>{});
    return ctx.editMessageText(`🧩 <b>پست‌ساز کانال</b>\n\nدکمه‌های فعلی: ${(s.data.buttonRows||[]).flat().length}\nمی‌توانی چند دکمه لینک‌دار اضافه کنی یا پیش‌نمایش نهایی را ببینی.`,{parse_mode:'HTML',reply_markup:channelBuilderKeyboard(s.data)}).catch(()=>ctx.reply('🧩 پست‌ساز کانال',{reply_markup:channelBuilderKeyboard(s.data)}));
  });
  bot.action('channel_buttons_manage',async ctx=>{
    if(!(await guard(ctx,'channelPosts')))return;
    const s=getState(ctx.from.id); if(!s)return;
    const flat=[]; (s.data.buttonRows||[]).forEach((row,ri)=>row.forEach((b,bi)=>flat.push({ri,bi,b})));
    const rows=flat.map(({ri,bi,b},i)=>[{text:`🗑 ${i+1}. ${b.text}`,callback_data:`channel_button_remove_${ri}_${bi}`,style:'danger'}]);
    rows.push([{text:'🔙 بازگشت به پست‌ساز',callback_data:'channel_builder'}]);
    await ctx.answerCbQuery();
    return ctx.editMessageText('🧩 برای حذف هر دکمه روی آن بزن.',{reply_markup:{inline_keyboard:rows}});
  });
  bot.action(/^channel_button_remove_(\d+)_(\d+)$/,async ctx=>{
    if(!(await guard(ctx,'channelPosts')))return;
    const s=getState(ctx.from.id); if(!s)return;
    const ri=Number(ctx.match[1]),bi=Number(ctx.match[2]);
    if(s.data.buttonRows?.[ri]?.[bi]){s.data.buttonRows[ri].splice(bi,1);if(!s.data.buttonRows[ri].length)s.data.buttonRows.splice(ri,1);}
    setState(ctx.from.id,'channel_post_builder',s.data); await ctx.answerCbQuery('حذف شد.');
    return ctx.editMessageText(`✅ دکمه حذف شد.\nتعداد باقی‌مانده: ${(s.data.buttonRows||[]).flat().length}`,{reply_markup:channelBuilderKeyboard(s.data)});
  });
  bot.action('channel_preview',async ctx=>{
    if(!(await guard(ctx,'channelPosts')))return;
    const s=getState(ctx.from.id); if(!s)return;
    await ctx.answerCbQuery();
    await sendChannelPreview(ctx,s.data);
    setState(ctx.from.id,'channel_post_preview',s.data);
    return ctx.reply('👁 پیش‌نمایش بالا آماده است. انتشار شود؟',{reply_markup:{inline_keyboard:[[{text:`✅ انتشار در ${env.channelUsername}`,callback_data:'channel_publish',style:'success'}],[{text:'✏️ بازگشت به ویرایش',callback_data:'channel_builder'}],[{text:'❌ لغو',callback_data:'cancel_input',style:'danger'}]]}});
  });
  bot.action('channel_publish',async ctx=>{
    if(!(await guard(ctx,'channelPosts')))return;
    const s=getState(ctx.from.id);if(!s||s.type!=='channel_post_preview')return;
    const d=s.data; const extra={parse_mode:'HTML'}; const replyMarkup=channelReplyMarkup(d); if(replyMarkup)extra.reply_markup=replyMarkup;
    let m;
    if(d.type==='photo')m=await ctx.telegram.sendPhoto(env.channelUsername,d.fileId,{caption:d.caption,...extra});
    else if(d.type==='video')m=await ctx.telegram.sendVideo(env.channelUsername,d.fileId,{caption:d.caption,...extra});
    else m=await ctx.telegram.sendMessage(env.channelUsername,d.caption,extra);
    const channelName=String(env.channelUsername).replace(/^@/,'');
    const postUrl=`https://t.me/${channelName}/${m.message_id}`;
    await ChannelPost.create({type:d.type,fileId:d.fileId||null,caption:d.caption,buttonRows:d.buttonRows||[],channelUsername:env.channelUsername,messageId:m.message_id,postUrl,createdBy:ctx.from.id});
    clearState(ctx.from.id); await ctx.answerCbQuery();
    return ctx.reply(`✅ پست با موفقیت منتشر شد.\n\n🔗 ${postUrl}\n🧩 تعداد دکمه‌ها: ${(d.buttonRows||[]).flat().length}`);
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
    if(state.type==='admin_lesson'){const d=state.data;if(d.step==='title'){if(text!=='همان')d.data.title=text;d.step='content';return ctx.reply('متن آموزش را بفرست.');}if(d.step==='content'){if(text!=='همان')d.data.content=text;if(d.mode==='edit')await AiLesson.findByIdAndUpdate(d.id,d.data);else await AiLesson.create({...d.data,createdBy:ctx.from.id,order:await AiLesson.countDocuments()+1});clearState(ctx.from.id);return ctx.reply('✅ ذخیره شد.');}}
    if(state.type==='request_edit'){await PromptRequest.findByIdAndUpdate(state.data.id,{text});clearState(ctx.from.id);return ctx.reply('✅ ویرایش شد.');}
    if(state.type==='admin_code'){const d=state.data;if(d.step==='title'){d.data.title=text;d.step='code';return ctx.reply('کد را بفرست. مثال: SUMMER50');}if(d.step==='code'){d.data.code=text.toUpperCase();d.step='type';return ctx.reply('نوع را بفرست: percent یا fixed');}if(d.step==='type'){d.data.type=text==='fixed'?'fixed':'percent';d.step='value';return ctx.reply('مقدار تخفیف؟');}if(d.step==='value'){d.data.value=Number(text);d.step='days';return ctx.reply('چند روز اعتبار دارد؟');}if(d.step==='days'){d.data.expiresAt=new Date(Date.now()+Number(text)*86400000);d.step='max';return ctx.reply('حداکثر استفاده کلی؟');}if(d.step==='max'){d.data.maxUses=Number(text);d.step='confirm';return ctx.reply(`👁 پیش‌نمایش\nعنوان: ${d.data.title}\nکد: ${d.data.code}\nمقدار: ${d.data.value}\nسقف: ${d.data.maxUses}\nانقضا: ${formatDateTime(d.data.expiresAt)}`,{reply_markup:{inline_keyboard:[[{text:'✅ ساخت کد',callback_data:'code_confirm',style:'success'},{text:'❌ لغو',callback_data:'cancel_input',style:'danger'}]]}});}}
    if(state.type==='admin_add'){const d=state.data;if(d.step==='id'){const id=Number(text);if(!id)return ctx.reply('آیدی عددی معتبر بفرست.');d.data.telegramId=id;d.step='perms';return ctx.reply('مجوزها را با ویرگول بنویس. مثال: prompts,lessons یا all');}if(d.step==='perms'){const names=['prompts','lessons','payments','users','discounts','broadcast','support','channelPosts','requests','results'];const selected=text.toLowerCase()==='all'?names:text.split(',').map(x=>x.trim()).filter(x=>names.includes(x));const permissions=Object.fromEntries(names.map(n=>[n,selected.includes(n)]));await Admin.findOneAndUpdate({telegramId:d.data.telegramId},{telegramId:d.data.telegramId,title:'ادمین',permissions,isActive:true,createdBy:ctx.from.id},{upsert:true,new:true});clearState(ctx.from.id);return ctx.reply('✅ ادمین و سطح دسترسی ذخیره شد.');}}
    if(state.type==='admin_edit_perms'){const names=['prompts','lessons','payments','users','discounts','broadcast','support','channelPosts','requests','results'];const selected=text.toLowerCase()==='all'?names:text.split(',').map(x=>x.trim()).filter(x=>names.includes(x));const permissions=Object.fromEntries(names.map(n=>[n,selected.includes(n)]));await Admin.findByIdAndUpdate(state.data.id,{permissions});clearState(ctx.from.id);return ctx.reply('✅ مجوزهای ادمین به‌روزرسانی شد.');}
    if(state.type==='broadcast'){setState(ctx.from.id,'broadcast_preview',{chatId:ctx.chat.id,messageId:ctx.message.message_id});return ctx.reply('👁 پیش‌نمایش بالا. برای همه ارسال شود؟',{reply_markup:{inline_keyboard:[[{text:'✅ ارسال همگانی',callback_data:'broadcast_confirm',style:'success'},{text:'❌ لغو',callback_data:'cancel_input',style:'danger'}]]}});}
    if (state.type === 'channel_post') {
      const flow = state.data;
      const data = flow.data || (flow.data = {});
      const step = flow.step;

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
        if (duplicate) return ctx.answerCbQuery('این اسلاگ قبلاً استفاده شده است.', { show_alert: true });
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
