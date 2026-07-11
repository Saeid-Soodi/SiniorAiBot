require('dotenv').config();
const required=['BOT_TOKEN','MONGODB_URI','OWNER_ID','BOT_USERNAME','CHANNEL_USERNAME','CHANNEL_URL'];
for(const key of required) if(!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
const clean=v=>String(v||'').replace('@','').trim();
const num=(v,fallback)=>Number.isFinite(Number(v))?Number(v):fallback;
const requiredChannels=(process.env.REQUIRED_CHANNELS||process.env.CHANNEL_USERNAME).split(',').map(clean).filter(Boolean).map(username=>({username:`@${username}`,url:`https://t.me/${username}`}));
module.exports={
 botToken:process.env.BOT_TOKEN,mongoUri:process.env.MONGODB_URI,
 ownerId:Number(process.env.OWNER_ID),
 adminIds:(process.env.ADMIN_IDS||'').split(',').map(v=>Number(v.trim())).filter(Boolean),
 botUsername:clean(process.env.BOT_USERNAME),channelUsername:`@${clean(process.env.CHANNEL_USERNAME)}`,
 channelUrl:process.env.CHANNEL_URL,requiredChannels,
 freeDailyLimit:num(process.env.FREE_DAILY_LIMIT,3),vipDailyLimit:num(process.env.VIP_DAILY_LIMIT,10),
 vipPriceToman:num(process.env.VIP_PRICE_TOMAN,60000),vipDays:num(process.env.VIP_DAYS,30),
 cardNumber:clean(process.env.CARD_NUMBER),cardHolder:process.env.CARD_HOLDER||'',supportUsername:clean(process.env.SUPPORT_USERNAME||'SiniorAi'),
 referralRequired:num(process.env.REFERRAL_REQUIRED,2),referralDiscountPercent:num(process.env.REFERRAL_DISCOUNT_PERCENT,40),
 referralRewardDays:num(process.env.REFERRAL_REWARD_DAYS,7),minPaymentToman:num(process.env.MIN_PAYMENT_TOMAN,10000)
};
module.exports.managementIds=[...new Set([module.exports.ownerId,...module.exports.adminIds].filter(Boolean))];
