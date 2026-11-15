import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../server/actions/activities.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('async function getMyActivityPage('),source.indexOf('async function getMyActivity('));
function harness(rows=[{id:11,submitted_at:'2026-11-15',sequence:2},{id:12,submitted_at:'2026-11-14',sequence:1}]){
 const calls=[];
 const database={
  rpc:(name,args)=>{calls.push({name,args});return {rows,total:rows.length};},
  from:table=>{
   const call={table};calls.push(call);
   const chain={
    select:columns=>{call.columns=columns;return chain;},
    eq:(column,value)=>{call.owner={column,value};return chain;},
    in:(column,ids)=>{call.ids={column,ids};return [{id:11,tg_posts:[{kind:'post',chatId:'private',messageId:1}]},{id:12,tg_posts:[{kind:'feedback'}]}];}
   };
   return chain;
  }
 };
 const fn=vm.runInNewContext(body+';getMyActivityPage',{requireActor:()=>({nid:'owner-1'}),db:()=>database,run:async v=>v,fmtTs:v=>v,toActivityRow:v=>v,AccessError:Error});
 return {fn,calls};
}
test('보고 표시에는 현재 계정·현재 페이지만 한 번 조회하고 Telegram 식별자는 반환하지 않는다',async()=>{
 const {fn,calls}=harness();const result=await fn({cards:true,reportStatus:true,limit:20});
 assert.deepEqual(Array.from(result.rows,r=>r.reported),[true,false]);
 assert.equal(calls.length,2);assert.equal(calls[0].args.p_nid,'owner-1');
 assert.deepEqual(calls[1].owner,{column:'nid',value:'owner-1'});
 assert.deepEqual(Array.from(calls[1].ids.ids),[11,12]);assert.equal(calls[1].columns,'id, tg_posts');
 assert.ok(result.rows.every(row=>!('tg_posts' in row)&&!('tgPosts' in row)&&!('reportText' in row)));
 assert.ok(!JSON.stringify(result).includes('private'));
});
test('기존 카드·원문 조회와 빈 페이지는 표시용 추가 조회를 만들지 않는다',async()=>{
 for(const [input,rows] of [[{cards:true},undefined],[{reportStatus:true},undefined],[{cards:true,reportStatus:true},[]]]){
  const {fn,calls}=harness(rows);const result=await fn(input);assert.equal(calls.length,1);
  if(input.cards&&!input.reportStatus)assert.ok(result.rows.every(row=>!('reported' in row)));
 }
});
