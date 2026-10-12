// 운영 서버(Vercel)에서 DB·봇 설정·AI 까지 실제로 닿는지 확인한다. 어느 방에도 글을 보내지 않는다.
//   node --env-file=.env tools/live-check.mjs
const API = 'https://jesajang-gil.vercel.app/api';
const key = process.env.TEACHERSQUARE_CRON_KEY;

async function call(payload) {
  const t = Date.now();
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  return { json: await r.json(), ms: Date.now() - t };
}
const show = (label, ok, detail) => console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);

// 1) DB
let r = await call({ action: 'checkAdmin', memberId: '00230901-00011' });
show('DB 조회', !!r.json.roster, `${r.ms}ms`);

// 2) 봇 설정·알림로그
r = await call({ action: 'tsStatus', key });
show('봇 설정', r.json.ok && r.json.hasToken && !!r.json.chatId, r.json.error || `알림로그 최근 ${r.json.recent?.length}건`);

// 3) 서머리 미리보기(글만 만들고 보내지 않는다)
r = await call({ action: 'tsStatus', key, preview: 'daily' });
show('아침 서머리 미리보기', !!r.json.parts?.length, r.json.error || `활동 ${r.json.total}건, ${r.json.parts?.length}통, ${r.ms}ms`);
r = await call({ action: 'tsStatus', key, preview: 'evening' });
show('저녁 서머리 미리보기', !!r.json.caption, r.json.error || r.json.caption?.split('\n').at(-1).replace(/<[^>]+>/g, ''));

// 4) 영상 자동 작업 대기 목록(목록만 보고 만들지는 않는다)
r = await call({ action: 'vtAuto', key, peek: true });
show('영상 자동 작업 목록', r.json.ok === true, r.json.error || `밀린 영상 ${r.json.pending?.length}편`);

// 5) AI 한 번(상담용 모델, 하루 20회 한도 중 1회)
r = await call({ action: 'generateContent', payload: { contents: [{ role: 'user', parts: [{ text: '"연결 확인"이라고만 답하세요.' }] }] } });
const answer = r.json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
show('AI 호출', !!answer && !answer.startsWith('⚠️'), `${answer.slice(0, 80)} (${r.ms}ms)`);
