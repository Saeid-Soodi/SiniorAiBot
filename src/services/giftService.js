const crypto = require('crypto');
const GiftCode = require('../models/GiftCode');
const { activateOrExtendVip } = require('./subscriptionService');

async function createGift({ buyerTelegramId, paymentId, vipDays }) {
  const code = crypto.randomBytes(9).toString('base64url');
  return GiftCode.create({ code, buyerTelegramId, paymentId, vipDays, status: 'active' });
}

async function redeemGift(code, userTelegramId) {
  const gift = await GiftCode.findOne({ code, status: 'active' });
  if (!gift) throw new Error('این لینک هدیه معتبر نیست یا قبلاً استفاده شده است.');
  gift.status = 'used'; gift.usedBy = userTelegramId; gift.usedAt = new Date();
  await gift.save();
  const user = await activateOrExtendVip(userTelegramId, gift.vipDays);
  return { gift, user };
}
module.exports = { createGift, redeemGift };
