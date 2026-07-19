const { toGregorian, isValidJalaaliDate } = require('jalaali-js');

function normalizeDigits(value = '') {
  return String(value).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
}
function parseOffsetMinutes(value = '+03:30') {
  const match = String(value).trim().match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return 210;
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}
function parseDateInput(value) {
  const text = normalizeDigits(value).trim().replace(/[.\-]/g, '/').replace(/\s+/g, '');
  const m = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return { ok:false, error:'فرمت تاریخ درست نیست. نمونه: 1405/05/10' };
  let [y,mo,d]=m.slice(1).map(Number), gy=y, gm=mo, gd=d, calendar='gregorian';
  if (y < 1700) {
    calendar='jalali';
    if (!isValidJalaaliDate(y,mo,d)) return { ok:false,error:'تاریخ شمسی واردشده معتبر نیست.' };
    ({gy,gm,gd}=toGregorian(y,mo,d));
  } else {
    const check=new Date(Date.UTC(y,mo-1,d));
    if (check.getUTCFullYear()!=y||check.getUTCMonth()!=mo-1||check.getUTCDate()!=d) return {ok:false,error:'تاریخ میلادی واردشده معتبر نیست.'};
  }
  return {ok:true, year:y,month:mo,day:d,gy,gm,gd,calendar, normalized:`${String(y).padStart(4,'0')}/${String(mo).padStart(2,'0')}/${String(d).padStart(2,'0')}`};
}
function parseTimeInput(value) {
  const text=normalizeDigits(value).trim().replace(/\s+/g,'');
  const m=text.match(/^(\d{1,2}):(\d{2})$/);
  if(!m) return {ok:false,error:'فرمت ساعت درست نیست. نمونه: 21:30'};
  const hour=Number(m[1]),minute=Number(m[2]);
  if(hour<0||hour>23||minute<0||minute>59) return {ok:false,error:'ساعت باید بین 00:00 تا 23:59 باشد.'};
  return {ok:true,hour,minute,normalized:`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`};
}
function combineSchedule(datePart,timePart,offsetMinutes=210){
  return new Date(Date.UTC(datePart.gy,datePart.gm-1,datePart.gd,timePart.hour,timePart.minute)-offsetMinutes*60000);
}
function parseScheduleInput(value, offsetMinutes=210){
  const text=normalizeDigits(value).trim().replace(/\s+-\s+/,' ');
  const m=text.match(/^(\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})[ T]+(\d{1,2}:\d{2})$/);
  if(!m)return null; const d=parseDateInput(m[1]),t=parseTimeInput(m[2]); return d.ok&&t.ok?combineSchedule(d,t,offsetMinutes):null;
}
function formatScheduledAt(date, offsetMinutes=210){
  if(!date)return '-'; const local=new Date(new Date(date).getTime()+offsetMinutes*60000); const p=n=>String(n).padStart(2,'0');
  return `${local.getUTCFullYear()}-${p(local.getUTCMonth()+1)}-${p(local.getUTCDate())} ${p(local.getUTCHours())}:${p(local.getUTCMinutes())}`;
}
module.exports={normalizeDigits,parseOffsetMinutes,parseDateInput,parseTimeInput,combineSchedule,parseScheduleInput,formatScheduledAt};
