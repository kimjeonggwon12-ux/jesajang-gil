import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberEntry,takeEntry,clearEntry} from '../next-app/lib/entry-handoff.ts';
import {classicSection} from '../next-app/lib/classic-navigation.mjs';
import {emptyActivity,activityPayload} from '../next-app/lib/activities.ts';
test('보고 작성 중 AI로 이동해도 원래 보고 입력과 전달 내용은 따로 한 번씩 복원한다',()=>{
 const context={memberId:'fake-991',name:'가짜 사용자',dept:'장년회',targets:[],today:'2026-11-15'};
 const activity=emptyActivity(context);Object.assign(activity,{targetName:'가짜 대상',todayWork:'오늘 내용',nextWork:'다음 내용'});
 const before=activityPayload(activity,context);
 rememberEntry({hints:context,chat:null,activity:structuredClone(activity),coaching:{stage:'만남1',targetGroup:'장년',situationText:'마스킹된 상담'}},'session-a');
 assert.equal(takeEntry('coaching','session-a').situationText,'마스킹된 상담');
 assert.deepEqual(activityPayload(takeEntry('activity','session-a'),context),before);
 assert.equal(takeEntry('activity','session-a'),null);assert.equal(takeEntry('coaching','session-a'),null);
});
test('다른 로그인 또는 로그아웃 뒤에는 미저장 입력을 복원하지 않는다',()=>{
 const value={hints:{memberId:'fake-991',name:'가짜',dept:'장'},chat:null,coaching:null,activity:{todayWork:'비공개 입력'}};
 rememberEntry(value,'session-a');assert.equal(takeEntry('activity','session-b'),null);assert.equal(takeEntry('activity','session-a'),null);
 rememberEntry(value,'session-a');clearEntry();assert.equal(takeEntry('activity','session-a'),null);
});
test('참여 하위 탭과 전도부 게시판은 원래 주 메뉴 표시를 유지한다',()=>{
 for(const section of ['yard','questions','bugs','contest'])assert.equal(classicSection('/community','section='+section),'join');
 assert.equal(classicSection('/community','section=evangelism'),'calendar');assert.equal(classicSection('/community','section=story'),'story');
});
