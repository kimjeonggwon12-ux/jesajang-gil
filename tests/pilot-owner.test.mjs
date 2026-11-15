import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isSystemOwner,systemOwnerNid} from '../server/lib/system-owner.js';
import {canManagePilot,pilotSite} from '../server/lib/pilot.js';
import {isAdmin,isApprover,isEvangelism} from '../server/actions/roster.js';
import {roomScopes,isRoomManager,mayReadRoom} from '../server/lib/room-scope.js';

test('확인된 책임자 번호는 선행 0/하이픈을 정규화하고 다른 소유자·운영자 목록은 배정 권한이 없다',async()=>{
 const before={owner:process.env.TEACHERSQUARE_SYSTEM_OWNER_ID,operators:process.env.PILOT_OPERATOR_IDS,enabled:process.env.PILOT_ROUTING_ENABLED};
 try{
  delete process.env.TEACHERSQUARE_SYSTEM_OWNER_ID;
  assert.equal(systemOwnerNid(),'');assert.equal(canManagePilot('00990000-00999'),false);
  process.env.TEACHERSQUARE_SYSTEM_OWNER_ID='00990000-00999';process.env.PILOT_OPERATOR_IDS='9900000000992,9900000000993';
  assert.equal(systemOwnerNid(),'99000000999');assert.equal(isSystemOwner('00990000-00999'),true);
  assert.equal(canManagePilot('9900000000992'),false);assert.equal(canManagePilot('9900000000993'),false);
  assert.equal(await isAdmin('00990000-00999'),true);assert.equal(await isApprover('00990000-00999'),true);assert.equal(await isEvangelism('00990000-00999'),true);
  assert.equal(isRoomManager({stage:'친분'},await roomScopes('00990000-00999'),null),true);
  assert.equal(mayReadRoom({creator_nid:'9900000000991'},null,'00990000-00999',false),true);
  assert.equal(mayReadRoom({creator_nid:'9900000000991'},null,'00990000-00999',false,true),false);
  process.env.PILOT_ROUTING_ENABLED='1';assert.equal((await pilotSite({nid:'99000000999'},'A')).site,'A');assert.equal((await pilotSite({nid:'99000000999'},'B')).site,'B');
  for(const invalid of ['', '99000000999,9900000000993','name:가짜책임자']){process.env.TEACHERSQUARE_SYSTEM_OWNER_ID=invalid;assert.equal(canManagePilot('00990000-00999'),false);}
 }finally{for(const [key,value]of [['TEACHERSQUARE_SYSTEM_OWNER_ID',before.owner],['PILOT_OPERATOR_IDS',before.operators],['PILOT_ROUTING_ENABLED',before.enabled]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
