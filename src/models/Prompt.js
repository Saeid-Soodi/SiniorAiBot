const mongoose=require('mongoose');
const schema=new mongoose.Schema({
 title:{type:String,required:true,trim:true},slug:{type:String,required:true,unique:true,index:true,lowercase:true,trim:true},
 promptText:{type:String,required:true},usageTip:{type:String,default:null},tools:[String],contentType:{type:String,default:'image'},categories:[String],
 imageFileId:{type:String,default:null},channelPostUrl:{type:String,default:null},accessLevel:{type:String,enum:['free','vip','exclusive'],default:'free'},
 isActive:{type:Boolean,default:true},totalClicks:{type:Number,default:0},uniqueClicks:{type:Number,default:0},joinSuccess:{type:Number,default:0},
 deliveries:{type:Number,default:0},favoriteCount:{type:Number,default:0},returnClicks:{type:Number,default:0},purchaseStarts:{type:Number,default:0},
 receiptCount:{type:Number,default:0},approvedPurchases:{type:Number,default:0},ratingCount:{type:Number,default:0},ratingSum:{type:Number,default:0},resultCount:{type:Number,default:0},createdBy:{type:Number,required:true}
},{timestamps:true});
module.exports=mongoose.model('Prompt',schema);
