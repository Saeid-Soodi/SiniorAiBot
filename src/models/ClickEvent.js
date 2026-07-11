const mongoose=require('mongoose');
const schema=new mongoose.Schema({telegramId:{type:Number,index:true},promptId:{type:mongoose.Schema.Types.ObjectId,ref:'Prompt',index:true},source:{type:String,default:'direct'},campaign:{type:String,default:null},event:{type:String,enum:['click','join','delivery','favorite','return','purchase_start','receipt','purchase_approved'],required:true,index:true}},{timestamps:true});
schema.index({telegramId:1,promptId:1,event:1});
module.exports=mongoose.model('ClickEvent',schema);
