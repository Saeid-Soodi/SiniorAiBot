const User = require('../models/User');
const WalletTransaction = require('../models/WalletTransaction');

async function creditWallet(userTelegramId, amount, meta = {}) {
  const user = await User.findOne({ telegramId: userTelegramId });
  if (!user) throw new Error('User not found');
  const before = user.walletBalance || 0;
  const after = before + Number(amount);
  user.walletBalance = after;
  await user.save();
  return WalletTransaction.create({
    userTelegramId, type: 'deposit', amount: Number(amount), balanceBefore: before, balanceAfter: after,
    referenceType: meta.referenceType || 'payment', referenceId: meta.referenceId || null,
    description: meta.description || 'شارژ کیف پول', createdBy: meta.createdBy || null
  });
}

async function debitWallet(userTelegramId, amount, meta = {}) {
  const user = await User.findOne({ telegramId: userTelegramId });
  if (!user) throw new Error('User not found');
  const value = Number(amount);
  if ((user.walletBalance || 0) < value) throw new Error('موجودی کیف پول کافی نیست.');
  const before = user.walletBalance || 0;
  const after = before - value;
  user.walletBalance = after;
  await user.save();
  return WalletTransaction.create({
    userTelegramId, type: 'purchase', amount: -value, balanceBefore: before, balanceAfter: after,
    referenceType: meta.referenceType || 'subscription', referenceId: meta.referenceId || null,
    description: meta.description || 'خرید از کیف پول', createdBy: meta.createdBy || userTelegramId
  });
}

module.exports = { creditWallet, debitWallet };
