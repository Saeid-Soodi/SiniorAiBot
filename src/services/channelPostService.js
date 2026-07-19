const ChannelPost = require('../models/ChannelPost');

function replyMarkup(buttonRows = []) {
  return Array.isArray(buttonRows) && buttonRows.length
    ? { inline_keyboard: buttonRows }
    : undefined;
}

function postUrl(channelUsername, messageId) {
  if (!messageId) return null;
  const channel = String(channelUsername || '').replace(/^@/, '');
  return `https://t.me/${channel}/${messageId}`;
}

async function publishChannelPayload(telegram, payload) {
  const channel = payload.channelUsername;
  const buttons = replyMarkup(payload.buttonRows);
  const messageIds = [];
  let messageId = null;
  let buttonMessageId = null;

  if (payload.sourceChatId && payload.sourceMessageId && payload.type === 'text') {
    const sent = await telegram.copyMessage(channel, payload.sourceChatId, payload.sourceMessageId, {
      ...(buttons ? { reply_markup: buttons } : {})
    });
    messageId = sent.message_id;
    messageIds.push(messageId);
  } else if (payload.type === 'album') {
    const ids = Array.isArray(payload.mediaFileIds) ? payload.mediaFileIds.slice(0, 10) : [];
    if (ids.length < 2) throw new Error('برای آلبوم حداقل ۲ تصویر لازم است.');

    const media = ids.map((fileId, index) => ({
      type: 'photo',
      media: fileId,
      ...(index === 0 ? { caption: payload.caption, parse_mode: 'HTML' } : {})
    }));

    const sent = await telegram.sendMediaGroup(channel, media);
    messageIds.push(...sent.map(item => item.message_id));
    messageId = sent[0]?.message_id || null;

    // Telegram media groups cannot carry an inline keyboard. Send buttons as a compact companion message.
    if (buttons) {
      const buttonMessage = await telegram.sendMessage(channel, '🔗 <b>لینک‌های مرتبط با این پست</b>', {
        parse_mode: 'HTML',
        reply_markup: buttons
      });
      buttonMessageId = buttonMessage.message_id;
      messageIds.push(buttonMessageId);
    }
  } else if (payload.type === 'photo') {
    const sent = await telegram.sendPhoto(channel, payload.fileId, {
      caption: payload.caption,
      ...(payload.captionEntities?.length ? { caption_entities: payload.captionEntities } : { parse_mode: 'HTML' }),
      ...(buttons ? { reply_markup: buttons } : {})
    });
    messageId = sent.message_id;
    messageIds.push(messageId);
  } else if (payload.type === 'video') {
    const sent = await telegram.sendVideo(channel, payload.fileId, {
      caption: payload.caption,
      ...(payload.captionEntities?.length ? { caption_entities: payload.captionEntities } : { parse_mode: 'HTML' }),
      ...(buttons ? { reply_markup: buttons } : {})
    });
    messageId = sent.message_id;
    messageIds.push(messageId);
  } else {
    const sent = await telegram.sendMessage(channel, payload.caption, {
      ...(payload.entities?.length ? { entities: payload.entities } : { parse_mode: 'HTML' }),
      ...(buttons ? { reply_markup: buttons } : {})
    });
    messageId = sent.message_id;
    messageIds.push(messageId);
  }

  return {
    messageId,
    messageIds,
    buttonMessageId,
    postUrl: postUrl(channel, messageId),
    publishedAt: new Date()
  };
}

async function publishStoredChannelPost(telegram, post) {
  try {
    const result = await publishChannelPayload(telegram, post);
    post.status = 'published';
    post.messageId = result.messageId;
    post.messageIds = result.messageIds;
    post.buttonMessageId = result.buttonMessageId;
    post.postUrl = result.postUrl;
    post.publishedAt = result.publishedAt;
    post.lastError = null;
    await post.save();
    return post;
  } catch (error) {
    post.status = 'failed';
    post.lastError = String(error?.response?.description || error?.message || error);
    await post.save().catch(() => {});
    throw error;
  }
}

async function claimAndPublishDuePost(telegram) {
  const post = await ChannelPost.findOneAndUpdate(
    { status: 'scheduled', scheduledAt: { $lte: new Date() } },
    { $set: { status: 'publishing', lastError: null } },
    { sort: { scheduledAt: 1 }, new: true }
  );
  if (!post) return null;
  return publishStoredChannelPost(telegram, post);
}

function startChannelPostScheduler(telegram, { intervalMs = 30_000 } = {}) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      // Drain all currently-due posts one by one.
      while (await claimAndPublishDuePost(telegram)) {}
    } catch (error) {
      console.error('CHANNEL_POST_SCHEDULER_ERROR', error);
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  run().catch(() => {});
  return () => clearInterval(timer);
}

module.exports = {
  publishChannelPayload,
  publishStoredChannelPost,
  startChannelPostScheduler
};
