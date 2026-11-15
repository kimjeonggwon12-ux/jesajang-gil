// API 등록 목록을 출력할 뿐 액션을 실행하지 않는다. 운영 환경·외부 통신을 사용하지 않는다.
import {readFileSync} from 'node:fs';
for (const key of Object.keys(process.env)) if (/SUPABASE|TEACHERSQUARE|GEMINI|TELEGRAM|R2_|ATTEND_|BOT_TOKEN|VERCEL|AUTH_SIGNING/.test(key)) delete process.env[key];
globalThis.fetch=async()=>{throw new Error('Network disabled in action inventory');};
const registry=new URL('../server/registry.js',import.meta.url);
const source=readFileSync(registry,'utf8');
const owners=new Map();
for(const match of source.matchAll(/^import \w+ from '(\.\/actions\/[^']+)';/gm)) {
  const mod=await import(new URL(match[1],registry));
  for(const name of Object.keys(mod.default)) owners.set(name,[...(owners.get(name)||[]),'server/'+match[1].slice(2)]);
}
const {actions}=await import(registry);
const {PUBLIC_ACTIONS,CRON_ACTIONS,GUEST_ACTIONS}=await import('../server/lib/auth.js');
const rows=Object.keys(actions).sort().map(action=>({
  action,source:owners.get(action)?.at(-1)||'확인 필요',duplicates:owners.get(action)?.slice(0,-1)||[],
  boundary:PUBLIC_ACTIONS.has(action)?'공개 예외':CRON_ACTIONS.has(action)?'예약 키 전용':GUEST_ACTIONS.has(action)?'회원 또는 초대 손님':'회원 로그인',
}));
const counts=Object.fromEntries([...new Set(rows.map(r=>r.boundary))].map(b=>[b,rows.filter(r=>r.boundary===b).length]));
console.log('# 교사광장 API 공통 경계 목록\n');
console.log('현재 로컬 코드의 등록 액션과 공통 인증 경계를 열거한다. 액션을 실행하거나 운영에 접속하지 않는다. **개별 업무 권한·부서·지역·과정·소유권 검증의 완료표가 아니다.** 별도 `api/tg.js` 웹훅과 운영 도구는 이 목록에 포함되지 않는다.\n');
console.log(`총 ${rows.length}개. ${Object.entries(counts).map(([k,v])=>k+' '+v+'개').join(', ')}.\n`);
console.log('재생성: 저장소에서 Node.js로 `tools/list-api-actions.mjs`를 실행한다. 개별 업무 결과는 `jesajang-gil-후속검증-20261112.md`와 `jesajang-gil-교육위임-텔레그램검증-20261112.md`를 따른다.\n');
console.log('| 액션 | 소유 파일 | 공통 경계 |\n| --- | --- | --- |');
for(const row of rows)console.log(`| \`${row.action}\` | [${row.source}](jesajang-gil/${row.source}) | ${row.boundary}${row.duplicates.length?' · 중복 등록 확인 필요':''} |`);
if(rows.some(r=>r.duplicates.length))console.log('\n중복 등록: '+JSON.stringify(rows.filter(r=>r.duplicates.length)));
