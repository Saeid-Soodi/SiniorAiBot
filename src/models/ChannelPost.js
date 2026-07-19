const mongoose = require('mongoose');

const buttonSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true }
}, { _id: false });

const schema = new mongoose.Schema({
  type: { type: String, enum: ['text', 'photo', 'video', 'album'], required: true },
  fileId: { type: String, default: null },
  mediaFileIds: { type: [String], default: [] },
  caption: { type: String, required: true },
  sourceChatId: { type: String, default: null },
  sourceMessageId: { type: Number, default: null },
  entities: { type: [mongoose.Schema.Types.Mixed], default: [] },
  captionEntities: { type: [mongoose.Schema.Types.Mixed], default: [] },
  buttonRows: { type: [[buttonSchema]], default: [] },
  channelUsername: { type: String, required: true },

  status: {
    type: String,
    enum: ['scheduled', 'publishing', 'published', 'failed', 'cancelled'],
    default: 'published',
    index: true
  },
  scheduledAt: { type: Date, default: null, index: true },
  publishedAt: { type: Date, default: null },
  lastError: { type: String, default: null },

  messageId: { type: Number, default: null },
  messageIds: { type: [Number], default: [] },
  buttonMessageId: { type: Number, default: null },
  postUrl: { type: String, default: null },
  createdBy: { type: Number, required: true }
}, { timestamps: true });

schema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model('ChannelPost', schema);
