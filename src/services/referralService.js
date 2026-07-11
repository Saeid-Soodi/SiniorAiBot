const User=require('../models/User');
const env=require('../config/env');
async function attachReferrer(user,referrerId){
 if(!referrerId||user.referredBy||user.telegramId===referrerId||user.createdAt.getTime()!==user.updatedAt.getTime()) return user;
 const referrer=await User.findOne({telegramId:referrerId,isBlocked:false});
 if(!referrer)return user;
 user.referredBy=referrerId; await user.save(); return user;
}
async function validateReferral(user,ctx){
 if(user.referralValidated||!user.referredBy)return false;
 user.referralValidated=true; await user.save();
 const referrer=await User.findOneAndUpdate({telegramId:user.referredBy},{$inc:{validReferralCount:1}},{new:true});
 if(!referrer)return false;
 if(!referrer.referralRewardIssued&&referrer.validReferralCount>=env.referralRequired){
  referrer.referralRewardIssued=true;
  referrer.referralDiscountUntil=new Date(Date.now()+env.referralRewardDays*86400000);
  await referrer.save();
  await ctx.telegram.sendMessage(referrer.telegramId,`🎉 تبریک! با ${env.referralRequired} دعوت معتبر، تخفیف ${env.referralDiscountPercent}٪ برای خرید VIP فعال شد.\nاعتبار تا: ${referrer.referralDiscountUntil.toLocaleDateString('fa-IR')}`).catch(()=>{});
 }
 return true;
}
module.exports={attachReferrer,validateReferral};
