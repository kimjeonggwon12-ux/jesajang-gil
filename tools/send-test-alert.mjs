// 교사광장 방으로 "연결 시험" 글을 한 통 실제로 보낸다(저장은 하지 않고 알림만). 사용자가 보내 달라고 했을 때만 실행한다.
//   node --env-file=.env tools/send-test-alert.mjs
const API = 'https://jesajang-gil.vercel.app/api';
const key = process.env.TEACHERSQUARE_CRON_KEY;

const call = async (payload) => (await fetch(API, {
  method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload),
})).json();

const before = await call({ action: 'tsStatus', key });
const sent = await call({
  action: 'tsTest', key, kind: 'savePlazaPost', memberId: '0020113000010', name: '김정권',
  data: { category: '나눔', title: '[연결 시험] 새 서버 알림 확인입니다 — 무시하셔도 됩니다' },
});
const after = await call({ action: 'tsStatus', key });
const last = after.recent?.at(-1) || [];
const isNew = JSON.stringify(last) !== JSON.stringify(before.recent?.at(-1) || []);
console.log('요청 결과:', JSON.stringify(sent));
console.log('알림로그 마지막 줄:', isNew ? `${last[0]} · ${last[1]} · ${last[3]} · ${String(last[2]).slice(0, 120)}` : '(새 줄이 없음)');
process.exit(isNew && last[3] === '성공' ? 0 : 1);
