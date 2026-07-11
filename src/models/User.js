const mongoose=require('mongoose');
const schema=new mongoose.Schema({
 telegramId:{type:Number,required:true,unique:true,index:true},firstName:String,username:String,
 source:{type:String,default:'direct'},campaign:{type:String,default:null},
 plan:{type:String,enum:['free','vip'],default:'free'},vipUntil:{type:Date,default:null},
 dailyUsed:{type:Number,default:0},usageDate:{type:String,default:null},
 isBlocked:{type:Boolean,default:false},blockedBot:{type:Boolean,default:false},notes:{type:String,default:''},
 favorites:[{type:mongoose.Schema.Types.ObjectId,ref:'Prompt'}],lessonFavorites:[{type:mongoose.Schema.Types.ObjectId,ref:'AiLesson'}],
 receivedPrompts:[{type:mongoose.Schema.Types.ObjectId,ref:'Prompt'}],recentLessons:[{type:mongoose.Schema.Types.ObjectId,ref:'AiLesson'}],
 referredBy:{type:Number,default:null,index:true},referralValidated:{type:Boolean,default:false},validReferralCount:{type:Number,default:0},
 referralRewardIssued:{type:Boolean,default:false},referralDiscountUntil:{type:Date,default:null},
 appliedDiscountCode:{type:String,default:null},
 lastLessonDate:{type:String,default:null},lessonIndex:{type:Number,default:0},lessonsRead:{type:Number,default:0},
 discountReminderSentAt:{type:Date,default:null}
},{timestamps:true});
module.exports=mongoose.model('User',schema);
