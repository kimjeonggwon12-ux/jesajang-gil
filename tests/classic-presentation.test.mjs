import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {classicNav,classicSection} from '../next-app/lib/classic-navigation.mjs';
import {relativeActivityTime,classicFlowStep} from '../next-app/lib/classic-activity.mjs';
const html=readFileSync(new URL('../app.html',import.meta.url),'utf8');
test('기존 하단 메뉴 순서와 관리자 숨김을 유지하고 같은 업무 경로를 가리킨다',()=>{
 const nav=html.slice(html.indexOf('<nav id="bottomTabBar"'),html.indexOf('</nav>',html.indexOf('<nav id="bottomTabBar"')));
 const order=[...nav.matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(classicNav(true).map(x=>x.id),order);
 assert.deepEqual(classicNav(false).map(x=>x.id),order.filter(x=>x!=='admin'));
 for(const item of classicNav(true)){const url=new URL(item.href,'https://local.invalid');assert.equal(classicSection(url.pathname,url.search),item.id);}
 for(const path of ['/','/rooms','/account'])assert.equal(classicSection(path),'activity');
 for(const path of ['/admin/pilot','/admin/roster','/members','/status','/centers'])assert.equal(classicSection(path),'admin');
});
test('누적 활동의 시각과 센터 과정 게이지가 원본 표시 결과와 같다',()=>{
 const time=html.slice(html.indexOf('    function actFeedTimeText('),html.indexOf('    // 누적 수치는 DB 요약',html.indexOf('    function actFeedTimeText(')));
 const flow=html.slice(html.indexOf('    function erFlowIndex('),html.indexOf('    function erFlowHtml('));
 const ctx={Date,RP_COURSES:['초등','중등','고등','수료'],ER_COURSE_FLOW:['개강','초등','중등','고등','수료'],ER_FULL_FLOW:['섭외','친분','만남1','만남2','상담1','상담2','복음방','개강 준비','개강','초등','중등','고등','수료']};
 vm.createContext(ctx);vm.runInContext(time+flow,ctx);
 for(const minutes of [0,10,120,1800,5000]){const value=new Date(Date.now()-minutes*60000).toISOString();assert.equal(relativeActivityTime(value),ctx.actFeedTimeText(value));}
 for(const stage of ['','섭외','친분','만남1','만남2','상담1','상담2','복음방','센터소개','센터수강'])for(const course of ['',...ctx.RP_COURSES])assert.equal(classicFlowStep(stage,course),ctx.erFlowIndex(stage,{course}));
});
