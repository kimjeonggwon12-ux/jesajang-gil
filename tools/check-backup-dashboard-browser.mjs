// 로컬 합성 계정 전용 브라우저 검사. 개인 Chrome 프로필/운영 세션을 사용하지 않는다.
import {chromium} from '/Users/guh98/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
import {writeFileSync,mkdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:58613',out=path.resolve(import.meta.dirname,'../../artifacts/backup-dashboard-20261115');
assert.equal(process.argv.length,2);assert.ok(!existsSync(path.join(out,'browser.json')),'이전 브라우저 결과 보존');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),blocked=[],errors=[],checks=[];
await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(blocked.push(new URL(route.request().url()).origin),route.abort()));
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const json=async url=>(await context.request.get(origin+url)).json();
const state=async value=>{assert.equal((await json('/__local/state?value='+value)).ok,true);};
async function session(person){const s=await json('/__local/session?person='+person);await page.evaluate(s=>{localStorage.setItem('pd_tk_v1',s.token);localStorage.setItem('podo_member',JSON.stringify(s.account));window.dispatchEvent(new Event('ts-session-change'));},s);return s;}
const text=async value=>{await page.getByText(value,{exact:true}).waitFor();};
try{
  await page.goto(origin+'/admin');await session(0);await text('백업 완료 기록 확인');
  let m=await json('/__local/metrics');assert.equal(m.counts.getBackupSummary,1);assert.ok(!m.storageCalls.some(c=>c.method==='GET'&&c.path.endsWith('.json.gz')));
  const first=m.counts.getBackupSummary;await page.waitForTimeout(1500);assert.equal((await json('/__local/metrics')).counts.getBackupSummary,first);
  checks.push({case:'owner-only-summary-no-archive-no-poll',passed:true});
  await page.screenshot({path:path.join(out,'desktop-healthy.png'),fullPage:true});
  await page.getByRole('button',{name:'상태 다시 확인',exact:true}).click();await text('백업 완료 기록 확인');assert.equal((await json('/__local/metrics')).counts.getBackupSummary,2);
  await page.getByRole('link',{name:'백업 관리로 이동'}).click();await page.getByRole('heading',{name:'명단 다운로드·백업'}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('tab'),'data');assert.equal((await json('/__local/metrics')).counts.getBackups,undefined);
  await page.getByRole('button',{name:'보관 중인 백업 보기'}).click();await page.getByText('백업 상태: 정상',{exact:true}).waitFor();
  m=await json('/__local/metrics');assert.equal(m.counts.getBackups,1);assert.ok(m.storageCalls.some(c=>c.method==='GET'&&c.path.endsWith('.json.gz')));assert.equal(m.counts.createBackup,undefined);assert.equal(m.counts.backupNow,undefined);
  checks.push({case:'detail-navigation-and-explicit-full-check',passed:true});
  for(const [value,label]of [['failed','최근 백업이 실패했어요'],['missing','확인된 백업이 없어요'],['stale','최근 백업이 오래되었어요'],['interrupted','백업이 끝났는지 확인이 필요해요'],['offline','백업 상태를 불러오지 못했어요. 다시 확인해 주세요.']]){
    await state(value);await page.goto(origin+'/admin');await text(label);assert.ok(await page.getByRole('alert').filter({hasText:label}).isVisible());
    if(value==='failed'){await page.setViewportSize({width:375,height:812});await page.screenshot({path:path.join(out,'mobile-warning.png'),fullPage:false});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
    checks.push({case:'warning-'+value,passed:true});
  }
  await state('healthy');await page.getByRole('button',{name:'상태 다시 확인',exact:true}).click();await text('백업 완료 기록 확인');checks.push({case:'error-retry-recovers',passed:true});
  for(const person of [1,2,3]){
    await state('healthy');const s=await session(person);await page.goto(origin+'/admin');
    await page.getByRole('heading',{name:'업무 관리',exact:true}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'백업 상태',exact:true}).count(),0);
    assert.equal((await json('/__local/metrics')).counts.getBackupSummary,undefined);
    const r=await context.request.post(origin+'/api',{data:{action:'getBackupSummary',_tk:s.token}});assert.equal(r.status(),403);
    checks.push({case:'non-owner-'+person+'-hidden-and-api-denied',passed:true});
  }
  await state('healthy');await session(0);await page.goto(origin+'/admin');await text('백업 완료 기록 확인');
  await page.screenshot({path:path.join(out,'mobile-healthy.png'),fullPage:false});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // 이전 책임자 응답이 다른 계정으로 전환된 뒤 도착해도 표시하지 않는다.
  let release,arrived;const pending=new Promise(resolve=>arrived=resolve),gate=new Promise(resolve=>release=resolve);
  await page.route('**/api',async route=>{
    const body=route.request().postDataJSON();
    if(body?.action==='getBackupSummary'){const response=await route.fetch();arrived();await gate;await route.fulfill({response});}
    else await route.continue();
  });
  await page.getByRole('button',{name:'상태 다시 확인',exact:true}).click();await pending;await session(2);release();
  await page.getByRole('heading',{name:'업무 관리',exact:true}).waitFor();await page.waitForTimeout(200);
  assert.equal(await page.getByRole('heading',{name:'백업 상태',exact:true}).count(),0);await page.unroute('**/api');
  checks.push({case:'late-owner-response-hidden-after-account-change',passed:true});
  await session(0);await text('백업 완료 기록 확인');await page.getByRole('button',{name:'로그아웃',exact:true}).click();
  await page.getByRole('button',{name:'입장하기',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'백업 상태',exact:true}).count(),0);
  checks.push({case:'logout-clears-owner-summary',passed:true});
  assert.deepEqual(errors,[]);
  writeFileSync(path.join(out,'browser.json'),JSON.stringify({checkedAt:new Date().toISOString(),browser:await browser.version(),checks,viewportWidths:[1440,375],javascriptErrors:errors,blockedExternalOrigins:[...new Set(blocked)],productionConnected:false,fixture:'Actual application UI/API/auth; synthetic DB and local Storage SDK responses'},null,2)+'\n');
  console.log(JSON.stringify({passed:checks.length,javascriptErrors:errors.length,productionConnected:false}));
}catch(error){await page.screenshot({path:path.join(out,'browser-failure.png'),fullPage:true});throw error;}
finally{await context.close();await browser.close();}
