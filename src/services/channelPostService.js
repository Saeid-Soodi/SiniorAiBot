const ChannelPost = require('../models/ChannelPost');

function cleanButton(button, { enhanced = true } = {}) {
  const result = { text: button.text, url: button.url };
  // Newer Telegram clients support these fields. We retry without them when
  // the connected Bot API rejects them.
  if (enhanced && button.style && button.style !== 'default') result.style = button.style;
  if (enhanced && button.iconCustomEmojiId) result.icon_custom_emoji_id = button.iconCustomEmojiId;
  return result;
}

function replyMarkup(buttonRows = [], options = {}) {
  return Array.isArray(buttonRows) && buttonRows.length
    ? { inline_keyboard: buttonRows.map(row => row.map(button => cleanButton(button, options))) }
    : undefined;
}

function postUrl(channelUsername, messageId) {
  if (!messageId) return null;
  const channel = String(channelUsername || '').replace(/^@/, '');
  return `https://t.me/${channel}/${messageId}`;
}

function errorDescription(error) {
  return String(error?.response?.description || error?.description || error?.message || error);
}

function formattedCaptionOptions(payload) {
  const entities = Array.isArray(payload.captionEntities) ? payload.captionEntities : [];
  return entities.length ? { caption_entities: entities } : {};
}

function formattedTextOptions(payload) {
  const entities = Array.isArray(payload.entities) ? payload.entities : [];
  return entities.length ? { entities } : {};
}

async function sendWithButtonFallback(sendEnhanced, sendPlain, hasButtons) {
  try {
    return await sendEnhanced();
  } catch (error) {
    const message = errorDescription(error).toLowerCase();
    const likelyButtonCompatibilityError = hasButtons && (
      message.includes('reply markup') ||
      message.includes('inline keyboard') ||
      message.includes('icon_custom_emoji') ||
      message.includes('button') ||
      message.includes('style')
    );
    if (!likelyButtonCompatibilityError) throw error;
    console.warn('CHANNEL_BUTTON_FALLBACK', errorDescription(error));
    return sendPlain();
  }
}

/**
 * Telegram does not allow reply_markup on sendMediaGroup. Trying to add a
 * keyboard to an album item afterwards is not reliable across Bot API
 * versions and caused the old "temporary error". Album posts are therefore
 * published as a reliable "cover + gallery":
 *   1) first photo = caption, formatting and buttons
 *   2) remaining photos = media group (or one photo)
 * This keeps the buttons visually attached to the post and preserves all
 * caption entities, including bold, blockquote and custom emoji.
 */
async function publishAlbum(telegram, channel, payload, enhancedButtons) {
  const ids = Array.isArray(payload.mediaFileIds) ? payload.mediaFileIds.slice(0, 10) : [];
  if (ids.length < 2) throw new Error('برای آلبوم حداقل ۲ تصویر لازم است.');

  const buttons = replyMarkup(payload.buttonRows, { enhanced: enhancedButtons });
  const cover = await telegram.sendPhoto(channel, ids[0], {
    caption: payload.caption,
    ...formattedCaptionOptions(payload),
    ...(buttons ? { reply_markup: buttons } : {})
  });

  const messageIds = [cover.message_id];
  const rest = ids.slice(1);
  if (rest.length === 1) {
    const item = await telegram.sendPhoto(channel, rest[0]);
    messageIds.push(item.message_id);
  } else if (rest.length > 1) {
    const gallery = await telegram.sendMediaGroup(channel, rest.map(fileId => ({ type: 'photo', media: fileId })));
    messageIds.push(...gallery.map(item => item.message_id));
  }

  return { messageId: cover.message_id, messageIds, buttonMessageId: buttons ? cover.message_id : null };
}

async function publishChannelPayload(telegram, payload) {
  const channel = payload.channelUsername;
  const hasButtons = Array.isArray(payload.buttonRows) && payload.buttonRows.flat().length > 0;

  const publish = async enhancedButtons => {
    const buttons = replyMarkup(payload.buttonRows, { enhanced: enhancedButtons });
    const messageIds = [];
    let messageId = null;
    let buttonMessageId = null;

    if (payload.sourceChatId && payload.sourceMessageId && payload.type === 'text' && !hasButtons) {
      // copyMessage is the most exact preservation path when no keyboard must
      // be added. With buttons we send explicitly so the keyboard is attached.
      const sent = await telegram.copyMessage(channel, payload.sourceChatId, payload.sourceMessageId);
      messageId = sent.message_id;
      messageIds.push(messageId);
    } else if (payload.type === 'album') {
      const result = await publishAlbum(telegram, channel, payload, enhancedButtons);
      messageId = result.messageId;
      messageIds.push(...result.messageIds);
      buttonMessageId = result.buttonMessageId;
    } else if (payload.type === 'photo') {
      const sent = await telegram.sendPhoto(channel, payload.fileId, {
        caption: payload.caption,
        ...formattedCaptionOptions(payload),
        ...(buttons ? { reply_markup: buttons } : {})
      });
      messageId = sent.message_id;
      messageIds.push(messageId);
      buttonMessageId = buttons ? messageId : null;
    } else if (payload.type === 'video') {
      const sent = await telegram.sendVideo(channel, payload.fileId, {
        caption: payload.caption,
        ...formattedCaptionOptions(payload),
        ...(buttons ? { reply_markup: buttons } : {})
      });
      messageId = sent.message_id;
      messageIds.push(messageId);
      buttonMessageId = buttons ? messageId : null;
    } else {
      const sent = await telegram.sendMessage(channel, payload.caption, {
        ...formattedTextOptions(payload),
        ...(buttons ? { reply_markup: buttons } : {})
      });
      messageId = sent.message_id;
      messageIds.push(messageId);
      buttonMessageId = buttons ? messageId : null;
    }

    return {
      messageId,
      messageIds,
      buttonMessageId,
      postUrl: postUrl(channel, messageId),
      publishedAt: new Date()
    };
  };

  return sendWithButtonFallback(
    () => publish(true),
    () => publish(false),
    hasButtons
  );
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
    post.lastError = errorDescription(error);
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
  startChannelPostScheduler,
  errorDescription
};
