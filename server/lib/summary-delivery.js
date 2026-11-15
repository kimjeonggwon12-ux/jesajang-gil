import {alreadySent,logAlert} from './alerts.js';
import {deliverReportBatch,reportBatchState} from './report-delivery-batch.js';
import {kstDate} from './util.js';
const mainContext=(key,kind)=>({namespace:'#main-summary',kind,ref:key||kind,date:key?.match(/\d{4}-\d{2}-\d{2}/)?.[0]||kstDate(),room:{dept:'#main-summary',chat_id:process.env.TEACHERSQUARE_CHAT_ID}});
export async function mainSummaryState(key,kind){
 if(!key)return 'pending';
 if(await alreadySent(key))return 'legacy';
 return reportBatchState(mainContext(key,kind));
}

async function confirmed(method,body){
 const response=await fetch(`https://api.telegram.org/bot${process.env.TEACHERSQUARE_BOT_TOKEN}/${method}`,{method:'POST',...body});
 const result=await response.json();
 if(typeof result.ok!=='boolean'||(!response.ok&&result.ok))throw Error('서머리 수신 확인 필요');
 return response.ok&&result.ok;
}
// 소통방의 여러 통 보고도 하나의 묶음이다. 사진의 명시적 거절만 글로 대체한다.
export async function sendMainSummary(parts,key,kind){
 if(!parts.length)return false;
 if(key&&await alreadySent(key))return true;
 if(!process.env.TEACHERSQUARE_BOT_TOKEN||!process.env.TEACHERSQUARE_CHAT_ID) return false;
 const result=await deliverReportBatch(mainContext(key,kind),async()=>{
  for(const part of parts){
   let sent=false;
   if(part.png){
    const form=new FormData();form.set('chat_id',process.env.TEACHERSQUARE_CHAT_ID);form.set('caption',String(part.caption||part.text||'').slice(0,1024));form.set('parse_mode','HTML');form.set('photo',new Blob([part.png],{type:'image/png'}),'summary.png');
    sent=await confirmed('sendPhoto',{body:form});
   }
   if(!sent){
    if(!part.text)throw Error('서머리 전달 거절');
    sent=await confirmed('sendMessage',{headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:process.env.TEACHERSQUARE_CHAT_ID,text:part.text,parse_mode:'HTML',disable_web_page_preview:true})});
   }
   if(!sent)throw Error('서머리 전달 거절');
  }
 },{manual:!key});
 if(result.ok)await logAlert(kind,parts.map(p=>p.text||p.caption||'').join('\n'),true,key);
 return result.ok;
}
