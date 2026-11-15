import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normId} from '../server/lib/util.js';

const source=readFileSync(new URL('../server/lib/pilot.js',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'').replace(/export /g,'').replace('default {getPilotAdmin,savePilotAdmin};','({getPilotAdmin,savePilotAdmin});');
function harness(actor={nid:'9900000000990'},members=['00990000-00991']){
 const calls=[],owner='9900000000990';
 const database={
  rpc:(name,args)=>{calls.push({name,args});return name==='site_pilot_search_assignable'?{rows:members.map(memberId=>({memberId,selected:false})),total:members.length}:{ok:true,version:2};},
  from:table=>{const chain={select:()=>chain,eq:()=>chain,order:()=>chain,single:async()=>({enabled:false,version:1}),limit:async()=>[],neq:async()=>({count:0})};return chain;},
 };
 const api=vm.runInNewContext(source,{process:{env:{}},db:()=>database,run:async x=>x,normId,systemOwnerNid:()=>owner,isSystemOwner:id=>normId(id)===owner,requireActor:()=>{if(!actor)throw Error('로그인 필요');return actor;},AccessError:Error,sensitiveActor:async()=>({actorNid:actor.nid,actorId:actor.nid})});
 return {api,calls};
}
const change=(targetIds,extra={})=>({operation:'assign',targetIds,expectedVersion:1,reason:'관리자 검증',confirmed:true,...extra});

test('명단에서 받은 하이픈·선행 0 번호를 배정과 해제에 그대로 사용해도 같은 정규 번호로 저장한다',async()=>{
 const {api,calls}=harness(),list=await api.getPilotAdmin({});
 for(const operation of ['assign','remove'])assert.equal((await api.savePilotAdmin(change(list.users.rows.map(p=>p.memberId),{operation}))).ok,true);
 const writes=calls.filter(x=>x.name==='site_pilot_apply');assert.equal(writes.length,2);
 for(const c of writes)assert.deepEqual(Array.from(c.args.p.targetIds),['99000000991']);
});
test('숫자 형식과 공백/하이픈 형식의 중복 대상은 한 명으로 처리한다',async()=>{
 const {api,calls}=harness();assert.equal((await api.savePilotAdmin(change(['0099000000991',' 00990000-00991 ','99000000991']))).ok,true);
 assert.deepEqual(Array.from(calls.at(-1).args.p.targetIds),['99000000991']);
});
test('잘못된 문자·길이·영 번호·빈 사유는 DB 저장 전에 거절한다',async()=>{
 for(const id of ['abc0099000000991','00990000/00991','00990000<script>00991','0000000000000','12','9'.repeat(41),991,null]){
  const {api,calls}=harness();assert.ok((await api.savePilotAdmin(change([id]))).error);assert.equal(calls.length,0);
 }
 const {api,calls}=harness();assert.ok((await api.savePilotAdmin(change(['00990000-00991'],{reason:'  '}))).error);assert.equal(calls.length,0);
});
test('책임자 자신·다른 관리자·손님은 번호 형식과 무관하게 배정 경계를 넘지 못한다',async()=>{
 const {api,calls}=harness();assert.match((await api.savePilotAdmin(change(['099000000-00990']))).error,/책임자/);assert.equal(calls.length,0);
 for(const actor of [null,{nid:'9900000000993'},{nid:'9900000000990',guest:true}]){
  const h=harness(actor);await assert.rejects(h.api.savePilotAdmin(change(['00990000-00991'])));assert.equal(h.calls.length,0);
 }
});
