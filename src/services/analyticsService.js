const ClickEvent=require('../models/ClickEvent');
const Prompt=require('../models/Prompt');
async function track({telegramId,promptId,source='direct',campaign=null,event}){
 await ClickEvent.create({telegramId,promptId,source,campaign,event});
 const inc={};
 if(event==='click') inc.totalClicks=1;
 if(event==='join') inc.joinSuccess=1;
 if(event==='delivery') inc.deliveries=1;
 if(event==='favorite') inc.favoriteCount=1;
 if(event==='return') inc.returnClicks=1;
 if(event==='purchase_start') inc.purchaseStarts=1;
 if(event==='receipt') inc.receiptCount=1;
 if(event==='purchase_approved') inc.approvedPurchases=1;
 if(promptId&&Object.keys(inc).length) await Prompt.updateOne({_id:promptId},{$inc:inc});
}
async function trackClick({telegramId,prompt,source,campaign}){
 const exists=await ClickEvent.exists({telegramId,promptId:prompt._id,event:'click'});
 await track({telegramId,promptId:prompt._id,source,campaign,event:'click'});
 if(!exists) await Prompt.updateOne({_id:prompt._id},{$inc:{uniqueClicks:1}});
}
module.exports={track,trackClick};
