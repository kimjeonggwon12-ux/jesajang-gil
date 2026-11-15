// 브라우저 수명에 묶인 읽기 제어. 계정/대화 전환 시 dispose하여 늦은 응답을 버린다.
export function createPrivateChat({request,chatId,memberId,onChange,visible=()=>true,schedule=setTimeout,cancel=clearTimeout}){
 let active=false,timer=null,running=null,loaded=false,cursor=0,pendingRead=0,idle=0,olderBusy=false;
 let state={rows:[],loaded:false,error:'',hasOlder:false,loadingOlder:false};
 const emit=()=>{if(active)onChange({...state,rows:[...state.rows]});};
 const merge=rows=>{const map=new Map(state.rows.map(row=>[row.id,row]));for(const row of rows)map.set(row.id,row);state.rows=[...map.values()].sort((a,b)=>a.id-b.id);};
 const clear=()=>{if(timer!==null)cancel(timer);timer=null;};
 const later=delay=>{clear();if(active&&visible())timer=schedule(()=>read(),delay);};
 async function acknowledge(rows){for(const row of rows)if(!row.read&&row.toId===memberId)pendingRead=Math.max(pendingRead,row.id);if(!pendingRead||!active||!visible())return;const throughId=pendingRead;try{const result=await request('markRead',{chatId,throughId});if(active&&result.ok&&pendingRead===throughId)pendingRead=0;}catch{/* 다음 읽기에서 확인한 범위만 재시도한다. */}}
 async function read(force=false){if(!active||!visible())return;if(running){await running;if(force&&active&&visible())return read();return;}clear();const initial=!loaded;
  running=(async()=>{let more=false;try{const result=await request('getMessages',{chatId,paged:true,...(loaded?{afterId:cursor}:{})});if(!active||!visible())return;merge(result.rows);cursor=result.nextCursor||cursor;if(initial)state.hasOlder=!!result.hasMore;more=!initial&&result.hasMore&&result.rows.length>0;loaded=true;state.loaded=true;state.error='';idle=result.rows.length?0:Math.min(idle+1,3);emit();await acknowledge(result.rows);}catch(error){if(active&&visible()){state.error=error.message;idle=Math.min(idle+1,3);emit();}}finally{running=null;later(more?100:Math.min(30000,5000*2**idle));}})();return running;
 }
 async function older(){if(!active||!visible()||!loaded||!state.hasOlder||olderBusy)return;olderBusy=true;state.loadingOlder=true;emit();try{const result=await request('getMessages',{chatId,paged:true,beforeId:state.rows[0]?.id});if(!active||!visible())return;merge(result.rows);state.hasOlder=!!result.hasMore;state.error='';emit();await acknowledge(result.rows);}catch(error){if(active){state.error=error.message;emit();}}finally{olderBusy=false;state.loadingOlder=false;emit();}}
 return {start(){active=true;void read();},dispose(){active=false;clear();},visibility(){clear();if(active&&visible()){idle=0;void read();}},refresh:()=>read(true),older};
}
