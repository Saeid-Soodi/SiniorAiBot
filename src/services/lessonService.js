const AiLesson = require('../models/AiLesson');
const User = require('../models/User');
const escapeHtml = require('../utils/html');
const { getIranDateKey } = require('../utils/date');
const { isOwner } = require('../utils/access');
const env = require('../config/env');

async function sendDailyLesson(ctx) {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return ctx.reply('ابتدا ربات را شروع کن.');
  const today = getIranDateKey();
  if (!isOwner(ctx.from.id) && user.lastLessonDate === today) {
    return ctx.reply(`📚 آموزش امروزت را قبلاً دریافت کردی.\n\nفردا یک نکته تازه برایت آماده می‌شود.\n\n💜 آموزش‌های Sinior Ai به‌مرور کامل‌تر و کاربردی‌تر می‌شوند.\n\nبرای پرامپت‌ها، آموزش‌های تازه و محتوای هوش مصنوعی:\n📢 ${env.channelUsername}\n🤖 @${env.botUsername}`);
  }
  const lessons = await AiLesson.find({ isActive: true, accessLevel: 'free' }).sort({ order: 1, createdAt: 1 });
  if (!lessons.length) return ctx.reply('هنوز آموزشی ثبت نشده است.');
  const lesson = lessons[user.lessonIndex % lessons.length];
  const ownerNote = isOwner(ctx.from.id) ? '\n\n👑 دسترسی مالک: محدودیت روزانه آموزش برای شما غیرفعال است.' : '\n\n📅 آموزش بعدی فردا در دسترس خواهد بود.';
  const text = `🎓 <b>آموزش امروزت: ${escapeHtml(lesson.title)}</b>\n\n${escapeHtml(lesson.content)}${ownerNote}\n\n💜 آموزش‌های Sinior Ai به‌مرور کامل‌تر و کاربردی‌تر می‌شوند.\n\nبرای دریافت پرامپت‌ها، آموزش‌های تازه و محتوای هوش مصنوعی:\n📢 ${env.channelUsername}\n🤖 @${env.botUsername}\n\n━━━━━━━━━━━━━━━\n🚀 <b>Sinior Ai</b> | مرجع آموزش و پرامپت‌های هوش مصنوعی`;
  if (lesson.imageFileId) await ctx.replyWithPhoto(lesson.imageFileId);
  await ctx.reply(text, { parse_mode: 'HTML' });
  if (!isOwner(ctx.from.id)) user.lastLessonDate = today;
  user.lessonIndex += 1; user.lessonsRead += 1; await user.save();
  await AiLesson.updateOne({ _id: lesson._id }, { $inc: { views: 1 } });
}
module.exports = { sendDailyLesson };
