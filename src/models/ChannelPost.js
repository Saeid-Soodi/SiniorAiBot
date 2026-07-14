const mongoose = require('mongoose');

const buttonSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true }
}, { _id: false });

const schema = new mongoose.Schema({
  type: { type: String, enum: ['text', 'photo', 'video'], required: true },
  fileId: { type: String, default: null },
  caption: { type: String, required: true },
  buttonRows: { type: [[buttonSchema]], default: [] },
  channelUsername: { type: String, required: true },
  messageId: { type: Number, required: true },
  postUrl: { type: String, default: null },
  createdBy: { type: Number, required: true }
}, { timestamps: true });

module.exports = mongoose.model('ChannelPost', schema);
