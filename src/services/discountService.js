const env=require('../config/env');
const DiscountCode=require('../models/DiscountCode');
function referralDiscount(user){
 if(user.referralRewardIssued&&user.referralDiscountUntil&&user.referralDiscountUntil>new Date()) return {source:'referral',percent:env.referralDiscountPercent,label:`رفرال ${env.referralDiscountPercent}٪`};
 return null;
}
async function validateCode(code,user){
 const item=await DiscountCode.findOne({code:String(code).trim().toUpperCase(),isActive:true});
 const now=new Date();
 if(!item) throw new Error('کد تخفیف معتبر نیست.');
 if(item.startsAt>now) throw new Error('زمان استفاده از این کد هنوز شروع نشده است.');
 if(item.expiresAt<=now) throw new Error('کد تخفیف منقضی شده است.');
 if(item.usedCount>=item.maxUses) throw new Error('ظرفیت استفاده از این کد تمام شده است.');
 const uses=item.usedBy.filter(id=>id===user.telegramId).length;
 if(uses>=item.maxUsesPerUser) throw new Error('قبلاً از این کد استفاده کرده‌اید.');
 return item;
}
async function calculatePrice(user,codeText){
 const original=env.vipPriceToman; let best={source:'none',amount:0,label:'بدون تخفیف',code:null};
 const ref=referralDiscount(user);
 if(ref){const amount=Math.floor(original*ref.percent/100);best={source:'referral',amount,label:ref.label,code:null};}
 if(codeText){const code=await validateCode(codeText,user);const amount=code.type==='percent'?Math.floor(original*code.value/100):Math.min(original,code.value);if(amount>best.amount) best={source:'code',amount,label:`کد ${code.code}`,code:code.code};}
 const finalPrice=Math.max(env.minPaymentToman,original-best.amount);
 return {originalPrice:original,discountAmount:original-finalPrice,finalPrice,discountSource:best.source,discountLabel:best.label,discountCode:best.code};
}
async function consumeCode(code,userId){if(!code)return;await DiscountCode.updateOne({code},{$inc:{usedCount:1},$push:{usedBy:userId}});}
module.exports={calculatePrice,validateCode,consumeCode};
