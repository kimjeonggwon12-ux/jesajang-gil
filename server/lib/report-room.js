// 보고방(교자장부청 공식 보고방, 텔레그램) — 출석 봇이 보고 문자를 그대로 올린다(2026-10-23).
// 부서 → 방은 report_rooms 표. 고친 보고는 처음 올린 글에 답장으로 "수정본"을 다시 올린다.
// 10/25: 지역 방(dept '부녀회/03지역')이 있으면 그 지역 사람 보고는 지역 방으로, 매일 22시에 방마다 일일 보고 취합(reportDailyTick).
import { db, run } from './db.js';
import { kstDate, kstDateTime, normId } from './util.js';
import { findTeacher, loadRoster, isApprover } from '../actions/roster.js';
import { tablePng } from './table-image.js';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const deptLabelOf = (dept) => { const d = String(dept || '').trim(); return !d ? '' : /(회|부)$/.test(d) ? d : d + '회'; };
const regionOf = (t) => { const m = String((t && t.region) || '').match(/^0*(\d+)지역$/); return m ? `${m[1]}지역` : ''; };   // '03지역' → '3지역'
const guOf = (t) => { const m = String((t && (t.affiliation || t.note)) || '').match(/지역-(\d{1,2})/); return m ? m[1].padStart(2, '0') : ''; };   // '03지역-01구' → '01'
// 텔레그램 해시태그 — 띄어쓰기·기호가 있으면 태그가 끊기므로 글자만 남긴다
const tag = (s) => { const v = String(s || '').replace(/[^0-9A-Za-z가-힣_]/g, ''); return v ? '#' + v : ''; };
// 10/29(사용자): 청년회 '기타' 방 = "기타(교문,새신자,회장단) 교사방" — 명단 지역 '새신자'도 기타 방으로(교회문화·회장단은 명단에서 이미 '기타').
const REGION_ROOM_ALIAS = { '청년회/새신자': '청년회/기타' };
const roomKeyOf = (dept, region) => { const k = `${String(dept).trim()}/${String(region).trim()}`; return REGION_ROOM_ALIAS[k] || k; };
export const regionRoomKey = (t) => (t && t.dept && t.region ? roomKeyOf(t.dept, t.region) : '');

/**
 * 이 부서의 보고방. 부서 방이 없으면 기본 방(dept '*')으로 — 10/23 사용자: "부서를 보고 맞는 방으로, 일단은 봇을 초대한 그 방으로".
 * 둘 다 없으면 null.
 */
export async function roomForDept(dept) {
  const rows = await run(db().from('report_rooms').select('*').in('dept', [dept || '', '*']).eq('active', true)).catch(() => []);
  return rows.find((x) => x.dept === dept) || rows.find((x) => x.dept === '*') || null;
}
/** 이 교사의 보고방: 지역 방('부서/지역') → 부서 방 → 기본 방. */
export async function roomForTeacher(t) {
  if (!t) return null;
  const keys = [regionRoomKey(t), String(t.dept || ''), '*'].filter(Boolean);
  const rows = await run(db().from('report_rooms').select('*').in('dept', keys).eq('active', true)).catch(() => []);
  for (const k of keys) { const r = rows.find((x) => x.dept === k); if (r) return r; }
  return null;
}

// 10/25(사용자): "상담 이상으로 체크된 건은 센터 인도 관리 건 — 지역 방에 보고된 것 중 그 건은 ○○회 전체 방에도".
// 10/27(사용자): 부서 전체 방(부녀회 43.11월 개강 교육 보고방)은 개강 인도 준비 방 — 상담1~복음방만 올리고 센터소개·센터수강부터는 올리지 않는다.
const COUNSEL_UP = ['상담1', '상담2', '복음방'];
export const isCounselUp = (row) => (row && row.activities || []).some((a) => COUNSEL_UP.includes(a));
// 부서 전체 방 일일 보고에는 상담1~복음방 칸만(지역 방에서 넘어온 건은 그 단계 항목만 남긴다)
const WHOLE_SECTIONS = ['🟢상담1️⃣', '🟢상담2️⃣', '🔵복음방'];

/** 이 보고를 올릴 방들: 내 방(roomForTeacher) + 내 방이 지역 방이고 상담 이상 건이면 부서 전체 방. */
export async function roomsForReport(t, row) {
  const room = await roomForTeacher(t);
  // 10/29(사용자): 전체 방엔 개별 보고는 상담1~복음방만 — 지역 방이 아직 없는 지역(장년회 13지역)도 같은 규칙(그 밖의 보고는 방이 생기면 그 방으로)
  if (room && room.dept === String(t.dept || '').trim() && regionRoomKey(t) && !isCounselUp(row)) {
    const sub = await run(db().from('report_rooms').select('dept').like('dept', `${room.dept}/%`).eq('active', true).limit(1)).catch(() => []);
    if (sub.length) return [];
  }
  if (!room || room.dept !== regionRoomKey(t) || !isCounselUp(row)) return room ? [room] : [];
  const whole = await roomForDept(String(t.dept || '').trim());
  return whole && whole.dept !== '*' && String(whole.chat_id) !== String(room.chat_id) ? [room, whole] : [room];
}

function botToken() {
  // 10/23: 보고방에는 출석 봇(@teachersquare_att_bot)이 초대돼 있어 그 봇으로 보낸다(출석 봇 웹훅은 교육 과정 방 글만 처리 — 보고방 글은 무시).
  const token = process.env.ATT_BOT_TOKEN || process.env.TEACHERSQUARE_BOT_TOKEN;
  if (!token) throw new Error('보고방 봇 설정(ATT_BOT_TOKEN)이 없습니다.');
  return token;
}
async function tg(method, body, token = botToken()) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) {
    const err = new Error('보고방에 올리지 못했습니다: ' + (j.description || r.status));
    err.migrateTo = j.parameters && j.parameters.migrate_to_chat_id;   // 일반 그룹 → 슈퍼그룹으로 바뀐 방의 새 번호
    throw err;
  }
  return j.result;
}
const replyTo = (id) => (id ? { reply_parameters: { message_id: Number(id), allow_sending_without_reply: true } } : {});

/** 글 하나 보내기 → 보낸 글 번호(실패하면 Error). 4096자 넘으면 잘라서 앞부분만. 본문은 esc 로 이스케이프해서 넘길 것. */
// 10/27: 주제(토픽)가 있는 방은 chat_id 를 '-100…/주제번호'로 적는다(부녀회 지역장+교관방의 '일일보고' 주제).
//   방 번호 '@교사활동현황' = 교사광장 봇(teachersquare_bot)의 기본 방 '교사광장(교사활동현황)'(TEACHERSQUARE_CHAT_ID) — 보고방 봇이 없는 방이라 그 봇으로.
const TS_ROOM = '@교사활동현황';
const target = (chatId) => {
  if (String(chatId) === TS_ROOM) return { chat_id: process.env.TEACHERSQUARE_CHAT_ID };
  const [id, th] = String(chatId).split('/'); return { chat_id: id, ...(th ? { message_thread_id: Number(th) } : {}) };
};
const tokenFor = (chatId) => (String(chatId) === TS_ROOM ? process.env.TEACHERSQUARE_BOT_TOKEN : botToken());
// 10/30: 일반 그룹이 슈퍼그룹으로 바뀌면 옛 번호로는 못 보낸다(청년회 1지역·장년회 새신자) — 텔레그램이 알려 준 새 번호로 연결을 고치고 한 번 더.
const MOVED = {};
async function healed(chatId, send) {
  try { return await send(chatId); }
  catch (e) {
    if (!e.migrateTo) throw e;
    const [id, th] = String(chatId).split('/');
    const next = String(e.migrateTo) + (th ? '/' + th : '');
    MOVED[String(chatId)] = next;
    await run(db().from('report_rooms').update({ chat_id: next }).eq('chat_id', id)).catch(() => {});
    console.log(`보고방 번호 바뀜: ${chatId} → ${next}`);
    return send(next);
  }
}
async function sendText(chatId, text, reply) {
  const res = await healed(chatId, (c) => tg('sendMessage', { ...target(c), text: String(text).slice(0, 4096), parse_mode: 'HTML', ...replyTo(reply) }, tokenFor(c)));
  return res.message_id;
}
/** 사진 묶음(1~3장, R2 주소) → 첫 사진 글 번호. caption 은 첫 사진 아래에 붙는다(1024자까지). */
async function sendAlbum(chatId, urls, caption, reply) {
  const media = urls.map((u, i) => ({ type: 'photo', media: u, ...(i === 0 && caption ? { caption, parse_mode: 'HTML' } : {}) }));
  const res = await healed(chatId, (c) => tg('sendMediaGroup', { ...target(c), media, ...replyTo(reply) }));
  return res[0].message_id;
}
const visibleLen = (html) => html.replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt);/g, '_').length;

/**
 * 보고 기록 한 줄(activities 행)을 보고방에 올린다. kind 'post' = 처음, 'edit' = 고친 뒤 다시.
 * 고친 글은 처음 올린 글에 답장으로 달고, 맨 위에 [수정본] 표시를 붙인다. 새 tg_posts 를 돌려준다.
 */
export async function postReport(row, room, kind) {
  const posts = Array.isArray(row.tg_posts) ? row.tg_posts : [];
  // 10/25: 한 보고가 지역 방·부서 전체 방 두 곳에 올라갈 수 있어 처음 글·지난 사진은 그 방 것만 본다. 이 방에 처음 글이 없으면 수정본도 처음 글로.
  const inRoom = posts.filter((p) => String(p.chat) === String(room.chat_id));
  const first = inRoom.find((p) => p.kind === 'post');
  if (kind === 'edit' && !first) kind = 'post';
  // 10/23(사용자): "보고자가 누구인지 알 수 없다" — 봇은 그 사람 프로필로 못 올리므로 맨 위에 보고자 이름(굵게)·부서·번호.
  //   이름·부서는 교사명단 기준(앱에 이름이 비어 있어도 나옴). 본문 맨 아래 옛 '✍️ 보고 :' 줄은 겹치므로 뺀다.
  // 10/25(사용자): 이름·지역 앞에 #(누르면 그 사람·그 지역 보고만 모아 봄), 맨 아래에도 보고자 이름과 소속을 한 번 더.
  const t = await findTeacher(row.member_id).catch(() => null);
  const nm = (t && t.name) || row.name || '이름 미상';
  const who = `<b>${esc(tag(nm) || nm)}</b>`;
  const deptLabel = deptLabelOf(t && t.dept);
  const tags = [deptLabel && tag(deptLabel), tag(regionOf(t))].filter(Boolean).join(' · ');
  const day = String(row.submitted_at || '').slice(5, 10).replace('-', '/').replace(/^0/, '');
  const head = kind === 'edit'
    ? `✏️ <b>[수정본]</b>  🙋 보고자 : ${who}${tags ? ` · ${esc(tags)}` : ''}\n${day} 보고를 고쳐 다시 올립니다`
    : `🙋 보고자 : ${who}${tags ? ` · ${esc(tags)}` : ''}  <code>${esc(row.member_id)}</code>`;
  const affil = String((t && (t.affiliation || t.region)) || '').trim();
  const foot = `🙋 보고자 : ${who}${deptLabel ? ` · ${esc(deptLabel)}` : ''}${affil && affil !== deptLabel ? ` · ${esc(affil)}` : ''}`;
  const body = esc(String(row.report_text || '').replace(/\n?✍️ 보고 :[^\n]*$/, '').trim());
  const text = `${head}\n\n${body}\n${foot}`;
  const reply = kind === 'edit' && first ? first.msg : null;

  // 10/25(사용자): 사진 3장까지 — 텔레그램에서 사진 묶음 아래 보고 글이 붙은 모양. 글이 길면(1024자 넘음) 사진 묶음 바로 뒤에 글을 답장으로.
  //   수정본은 사진이 바뀌었을 때만 사진 묶음을 다시 올린다.
  const photos = ((row.report && row.report.photos) || []).filter((u) => /^https:\/\//.test(u)).slice(0, 3);
  const ph = photos.join(' ');
  const lastPh = [...inRoom].reverse().find((p) => p.ph !== undefined);
  let msg;
  if (photos.length && (kind !== 'edit' || !lastPh || lastPh.ph !== ph)) {
    if (visibleLen(text) <= 1024) msg = await sendAlbum(room.chat_id, photos, text, reply);
    else {
      const albumMsg = await sendAlbum(room.chat_id, photos, `${head}\n📷 사진 ${photos.length}장 · 보고 글은 바로 아래에`, reply);
      msg = await sendText(room.chat_id, text, albumMsg);
    }
  } else msg = await sendText(room.chat_id, text, reply);
  const next = posts.concat([{ chat: MOVED[String(room.chat_id)] || String(room.chat_id), msg, at: kstDateTime(), kind, ph }]);
  await run(db().from('activities').update({ tg_posts: next }).eq('id', row.id));
  return next;
}

// ── 지역 일일 보고 취합 (2026-10-25) ── 사용자: "한 지역의 방에서 저녁 22:00가 되면 일일 보고가 취합되어 올라오게".
//   그날(기록 날짜 기준) 남긴 활동을 방마다 묶어 지역 보고 틀(📍3지역-일일 보고)로 보낸다. 5분마다 도는 attAutoSummary 가 부르고,
//   같은 방·같은 날은 cohort_summary_log 로 한 번만. 줄 = "구역 섭외자-인도자", 그날 처음 등록한 섭외자는 ✅신규.
const DAILY_SECTIONS = [
  ['💜새찾기', ['섭외']],
  ['🟠만남', ['친분', '만남1', '만남2']],
  ['🟢상담1️⃣', ['상담1']],
  ['🟢상담2️⃣', ['상담2']],
  ['🔵복음방', ['복음방']],
  ['🏛센터소개', ['센터소개']],
  ['🎓센터수강', ['센터수강']],
];
const DAILY_MANUAL = ['🔴확정(O)', '🟡확정(N)', '🟣지역장 승인'];   // 앱에 아직 없는 단계 — 틀 그대로 빈칸
const LINE = 'ㅡㅡㅡㅡㅡㅡㅡ';
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const leaderName = (v) => String(v || '').replace(/\(.*$/, '').trim();
const leaderId = (v) => { const m = String(v || '').match(/\(([^)]+)\)/); return m ? m[1].trim() : ''; };

/** 한 방의 일일 보고 글. acts = 그 방 사람들의 그날 기록(+ teacher). leaders = nid → 교사명단 행(인도자 구역 찾기). */
export function dailyText(roomTitle, date, acts, newSet, leaders, only = null) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const out = [`📍${roomTitle}-일일 보고 (${y - 1983}.${m}.${d}.${wd}요일)`, '', LINE, '구역 사랑이-인도자', LINE];
  DAILY_SECTIONS.forEach(([label, items], si) => {
    if (only && !only.includes(label)) return;
    const seen = new Map();
    for (const a of acts) {
      const name = String(a.target_name || '').trim();
      if (!name || !(a.activities || []).some((x) => items.includes(x))) continue;
      const lv = (a.report && a.report.team && a.report.team.leader) || '';
      const lt = leaders.get(normId(leaderId(lv))) || null;
      const leader = leaderName(lv) || (a.teacher && a.teacher.name) || a.name || '';
      const gu = guOf(lt || a.teacher);
      const key = `${name}|${leader}`;
      if (!seen.has(key)) seen.set(key, { gu, line: `${gu ? gu + ' ' : ''}${name}-${leader}${newSet.has(name) ? '✅신규' : ''}` });
    }
    const rows = [...seen.values()].sort((p, q) => (p.gu || '99').localeCompare(q.gu || '99') || p.line.localeCompare(q.line, 'ko'));
    if (only) { if (label !== only[0]) out.push(si === 3 ? '' : LINE); }
    else if (si === 3 || si === 6) out.push('');   // 상담2·센터수강은 앞 칸과 한 묶음(빈 줄만)
    else if (si > 0) out.push(LINE);
    out.push(`${label}- ${rows.length}명`, ...rows.map((r) => r.line));
  });
  if (only) out.push(LINE);
  else out.push(LINE, ...DAILY_MANUAL.flatMap((l, i) => [...(i ? [''] : []), `${l}- 명`]));
  return out.join('\n');
}

/** 그날 기록을 방마다 묶어 일일 보고 글들을 만든다 → [{ room, text, count }] */
export async function buildDailyReports(date, onlyDept = '') {
  // 묶기는 모든 방 기준(지역 방 사람이 부서 방으로 새지 않게), 돌려주는 것만 onlyDept
  const rooms = (await run(db().from('report_rooms').select('*').eq('active', true))).filter((r) => r.dept !== '*' && !r.dept.includes('#'));
  if (!rooms.some((r) => !onlyDept || r.dept === onlyDept)) return [];
  const acts = await run(db().from('activities').select('id, member_id, nid, name, activities, roles, target_name, report, submitted_at')
    .gte('submitted_at', `${date} 00:00:00`).lte('submitted_at', `${date} 23:59:59`).order('id'));
  const nids = acts.map((a) => a.nid).filter(Boolean);
  const leaderIds = acts.map((a) => normId(leaderId(a.report && a.report.team && a.report.team.leader))).filter(Boolean);
  const want = [...new Set([...nids, ...leaderIds])];
  const teachers = want.length ? await run(db().from('teachers').select('nid, name, dept, region, affiliation, note').in('nid', want)) : [];
  const byNid = new Map(teachers.map((t) => [t.nid, t]));
  const names = [...new Set(acts.map((a) => String(a.target_name || '').trim()).filter(Boolean))];
  const fresh = names.length
    ? await run(db().from('targets').select('target_name').in('target_name', names).gte('created_at', `${date} 00:00:00`).lte('created_at', `${date} 23:59:59`))
    : [];
  const newSet = new Set(fresh.map((t) => t.target_name.trim()));
  const roomKeys = new Set(rooms.map((r) => r.dept));
  const groups = new Map(rooms.map((r) => [r.dept, []]));
  for (const a of acts) {
    const t = byNid.get(a.nid);
    if (!t) continue;   // 교사명단에 없는 번호(시험 계정)는 뺀다
    const key = roomKeys.has(regionRoomKey(t)) ? regionRoomKey(t) : roomKeys.has(t.dept) ? t.dept : '';
    if (key) groups.get(key).push({ ...a, teacher: t });
    // 지역 방에 들어간 상담 이상 건은 부서 전체 방 일일 보고에도(roomsForReport 와 같은 규칙)
    if (key && key === regionRoomKey(t) && roomKeys.has(t.dept) && isCounselUp(a)) groups.get(t.dept).push({ ...a, activities: a.activities.filter((x) => COUNSEL_UP.includes(x)), teacher: t });
  }
  return rooms.filter((r) => !onlyDept || r.dept === onlyDept).map((room) => {
    const list = groups.get(room.dept);
    const region = room.dept.includes('/') ? room.dept.split('/')[1] : '';
    const title = region ? regionOf({ region }) || region : deptLabelOf(room.dept);
    // 아래에 지역 방이 있는 부서 전체 방(= 개강 인도 준비 방)은 상담1~복음방 칸만
    const whole = !region && rooms.some((r) => r.dept.startsWith(room.dept + '/'));
    const shown = whole ? list.filter(isCounselUp) : list;
    return { room, count: shown.length, text: dailyText(title, date, shown, newSet, byNid, whole ? WHOLE_SECTIONS : null) };
  });
}

// ── 부서 지역별 총합 (2026-10-27) ── 사용자: "부녀회 1~12지역·유아모·새신자 14개 조직을 단계별로 취합해 지역끼리 한눈에 비교,
//   맨 아래에는 단계별 토탈(새찾기~센터수강)" → 부녀회 지역장+교관방. 방 열쇠 '부녀회#총합'(사람 보고는 이 방으로 안 감).
//   조직 = 그 부서의 지역 방들(지역 방과 같은 묶음·같은 건수: 섭외자-인도자 한 쌍을 한 건).
//   10/27(사용자: "글 표는 보기 사납다"): 한글 문서 표처럼 사진 표(1열 = 14개 조직, 옆으로 단계 칸) + 아래 설명 글(신청 현황 글 모양).
const SUMMARY_COLS = [['새찾기', '💜'], ['만남', '🟠'], ['상담1', '🟢'], ['상담2', '🟢'], ['복음방', '🔵'], ['센터소개', '🏛'], ['센터수강', '🎓']];
// 10/29(사용자): 장년회 1~13지역·새신자 — 13지역은 방이 아직 없지만 총합 표엔 넣는다(방이 생기면 그대로 이어짐)
const SUMMARY_EXTRA_ORGS = { '장년회': ['13지역'] };
const DEPT_ORDER =['교역자', '자문회', '장년회', '부녀회', '청년회'];
const deptRank = (key) => { const i = DEPT_ORDER.indexOf(key.split(/[#/]/)[0]); return i < 0 ? 9 : i; };
const orgOrder = (r) => { const m = r.match(/^0*(\d+)/); return m ? [0, Number(m[1])] : [1, ['유아모', '새신자'].indexOf(r) + 1 || 9]; };
const countPairs = (acts, items) => new Set(acts.filter((a) => (a.activities || []).some((x) => items.includes(x)))
  .map((a) => `${String(a.target_name || '').trim()}|${leaderName((a.report && a.report.team && a.report.team.leader) || '') || a.nid}`)
  .filter((k) => !k.startsWith('|'))).size;

export function summaryBoard(dept, date, orgs, actsByOrg) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const total = DAILY_SECTIONS.map(() => 0);
  const per = orgs.map((org) => {
    const nums = DAILY_SECTIONS.map(([, items], i) => { const n = countPairs(actsByOrg.get(org) || [], items); total[i] += n; return n; });
    return { org, nums, sum: nums.reduce((a, b) => a + b, 0) };
  });
  const sum = total.reduce((a, b) => a + b, 0);
  const done = orgs.filter((o) => (actsByOrg.get(o) || []).length).length;
  const title = `${deptLabelOf(dept)} 지역별 일일 보고 총합`;
  const day = `${y - 1983}.${m}.${d}.${wd}요일`;
  // 사진 표: 1열 조직, 옆으로 새찾기~센터수강 + 계, 맨 아래 총합 줄
  const head = ['지역', ...SUMMARY_COLS.map(([l]) => l), '계'];
  const rows = [...per.map((p) => [p.org, ...p.nums.map((n) => n || '-'), p.sum || '-']), ['총합', ...total, sum]];
  const last = rows.length - 1, sumCol = head.length - 1;
  let png = null;
  try {
    png = tablePng({
      title, sub: `${day} · 섭외자-인도자 한 쌍 = 1건`, head, rows, align: ['left'],
      style: (r, c, v) => {
        if (r === last) return { fill: c ? '#e3f6ef' : '#d3efe4', bold: true, color: '#0b5e44' };
        if (v === '-') return { color: '#b0b8b4' };
        if (c === 0) return { bold: true };
        if (c === sumCol) return { bold: true, color: '#00875f' };
        return null;
      },
    });
  } catch (e) { console.log('총합 표 이미지 오류: ' + e.message); }
  // 사진 아래 설명(신청 현황 글 모양)
  const caption = [
    `📊 <b>${esc(title)}</b> (${day})`, '',
    `📌 <b>합계</b> : <b>${sum}건</b>`,
    `🗂️ <b>보고 올라온 조직</b> : ${done}/${orgs.length}`, '',
    '🧭 <b>단계별 토탈</b>',
    ...SUMMARY_COLS.map(([l, e], i) => `${e} <b>${l}</b> : ${total[i]}건`),
  ].join('\n');
  // 사진을 못 보낼 때의 글: 조직마다 줄을 바꿔 단계별 숫자
  const text = [
    caption, '', '🗂️ 지역별 현황',
    ...per.flatMap((p) => [` ▸ ${esc(p.org)} (총 ${p.sum}건)`,
      p.sum ? '   ' + p.nums.map((n, i) => (n ? `${SUMMARY_COLS[i][0]} ${n}` : '')).filter(Boolean).join(' · ') : '   보고 없음']),
  ].join('\n');
  return { caption, text, png };
}

/** 총합 방들('부서#총합')의 글 → [{ room, count, text, caption, png }]. text·caption 은 이미 HTML(esc 끝남). */
export async function buildSummaryReports(date, onlyKey = '') {
  const all = (await run(db().from('report_rooms').select('*').eq('active', true)));
  // '부녀회#총합' = 부서 대표 방, '부녀회#총합:활동현황' 처럼 뒤에 붙이면 같은 총합을 다른 방에도(10/27 교사광장 교사활동현황 방)
  // 10/29(사용자): 교사광장 활동 방처럼 여러 부서 총합이 한 방에 모이면 교자장부청 순서로
  const sums = all.filter((r) => r.dept.includes('#총합') && (!onlyKey || r.dept === onlyKey))
    .sort((a, b) => deptRank(a.dept) - deptRank(b.dept) || a.dept.localeCompare(b.dept));
  if (!sums.length) return [];
  const acts = await run(db().from('activities').select('id, member_id, nid, name, activities, target_name, report, submitted_at')
    .gte('submitted_at', `${date} 00:00:00`).lte('submitted_at', `${date} 23:59:59`).order('id'));
  const nids = [...new Set(acts.map((a) => a.nid).filter(Boolean))];
  const teachers = nids.length ? await run(db().from('teachers').select('nid, dept, region').in('nid', nids)) : [];
  const byNid = new Map(teachers.map((t) => [t.nid, t]));
  return sums.map((room) => {
    const dept = room.dept.split('#')[0];
    const orgs = [...new Set([...all.filter((r) => r.dept.startsWith(dept + '/')).map((r) => r.dept.split('/')[1]), ...(SUMMARY_EXTRA_ORGS[dept] || [])])]
      .sort((a, b) => { const p = orgOrder(a), q = orgOrder(b); return p[0] - q[0] || p[1] - q[1]; });
    const actsByOrg = new Map(orgs.map((o) => [o, []]));
    for (const a of acts) {
      const t = byNid.get(a.nid);
      const org = t && String(t.dept || '').trim() === dept ? regionRoomKey(t).split('/')[1] : '';
      if (org && actsByOrg.has(org)) actsByOrg.get(org).push(a);
    }
    const count = [...actsByOrg.values()].reduce((n, l) => n + l.length, 0);
    return { room, count, ...summaryBoard(dept, date, orgs, actsByOrg), html: true };
  });
}

/**
 * 출석 봇이 받은 글 하나 — 총합 방('…#총합')에 주제 번호가 아직 없고, 그 글이 이름에 '일일보고'가 든 주제에서 왔으면
 * 그 주제로 연결한다(봇 API 로는 주제 목록을 못 읽어서, 그 주제에 누가 글을 쓰면 번호를 안다). 연결했으면 true.
 */
const TOPIC_OF_ROOM = { '청년회/06지역': '전도', '청년회/03지역': '보고' };   // 방 열쇠 → 주제 이름에 든 글자(띄어쓰기 빼고)
export async function learnSummaryTopic(msg) {
  const th = msg && msg.is_topic_message && msg.message_thread_id;
  const name = String((msg && msg.reply_to_message && msg.reply_to_message.forum_topic_created && msg.reply_to_message.forum_topic_created.name) || '').replace(/\s/g, '');
  // 10/29(사용자): 주제가 있는 지역 방은 정한 주제로 — 활동 보고·22시 일일 보고가 그 주제에(청년회 6지역 '전도 활동', 3지역 '보고방').
  if (!th || !name) return false;
  const kind = name.includes('일일보고') ? 'sum' : 'room';
  const rows = (await run(db().from('report_rooms').select('dept, chat_id').eq('chat_id', String(msg.chat.id))).catch(() => []))
    .filter((r) => (kind === 'sum' ? r.dept.includes('#총합') : TOPIC_OF_ROOM[r.dept] && name.includes(TOPIC_OF_ROOM[r.dept])));
  for (const r of rows) await run(db().from('report_rooms').update({ chat_id: `${msg.chat.id}/${th}` }).eq('dept', r.dept));
  if (rows.length) await sendText(`${msg.chat.id}/${th}`, kind === 'sum'
    ? '✅ 이 주제(일일보고)로 매일 22시 지역별 일일 보고 총합이 올라와요.'
    : '✅ 이 주제로 교사들의 활동 보고와 매일 22시 일일 보고가 올라와요.').catch(() => {});
  return rows.length > 0;
}

/** 일일 보고 한 통 — 총합은 표 사진 + 설명(사진을 못 만들거나 못 보내면 글로). pre = 맨 위에 붙일 HTML 한 줄. */
async function sendDaily(r, pre = '') {
  if (r.png) {
    try {
      const form = new FormData();
      const t = target(r.room.chat_id);
      form.set('chat_id', t.chat_id);
      if (t.message_thread_id) form.set('message_thread_id', String(t.message_thread_id));
      form.set('caption', (pre + r.caption).slice(0, 1024));
      form.set('parse_mode', 'HTML');
      form.set('photo', new Blob([r.png], { type: 'image/png' }), 'summary.png');
      const j = await (await fetch(`https://api.telegram.org/bot${tokenFor(r.room.chat_id)}/sendPhoto`, { method: 'POST', body: form })).json().catch(() => ({}));
      if (j.ok) { r.via = '사진'; return j.result.message_id; }
      r.photoError = j.description || '';
      console.log('총합 사진 실패, 글로 보냄: ' + r.photoError);
    } catch (e) { r.photoError = e.message; console.log('총합 사진 실패, 글로 보냄: ' + e.message); }
  }
  return sendText(r.room.chat_id, pre + (r.html ? r.text : esc(r.text)));
}

/** 5분마다: 22시가 지나면 오늘 일일 보고를 방마다 한 번씩. */
export async function reportDailyTick() {
  if (kstDateTime().slice(11, 16) < '22:00') return [];
  const date = kstDate();
  const sent = [];
  for (const r of [...await buildDailyReports(date), ...await buildSummaryReports(date)]) {
    const { room, count } = r;
    if (!count) continue;   // 그날 기록이 하나도 없는 방은 보내지 않는다(빈 보고로 방을 채우지 않게)
    const { error } = await db().from('cohort_summary_log').insert({ cohort_id: '#report-room', kind: '일일보고', ref_id: room.dept, date, sent_at: kstDateTime() });
    if (error) continue;   // 이미 보냄
    try { await sendDaily(r); sent.push(room.dept); }
    catch (e) {
      // 못 보냈으면 표시를 지워 다음 5분에 다시
      await db().from('cohort_summary_log').delete().eq('cohort_id', '#report-room').eq('ref_id', room.dept).eq('date', date);
      console.log(`일일 보고 실패(${room.dept}): ${e.message}`);
    }
  }
  return sent;
}

// ── 관리용(운영 키 필요) ── 봇이 들어간 방 찾기 · 부서와 방 연결. 예) { action:'reportRooms', key, op:'candidates' }
//   op 'candidates' = 최근에 봇이 받은 방들(봇 초대 뒤 그 방에 아무 글이나 하나 올리면 보인다; 이 봇은 웹훅이 없어 getUpdates 로 읽음)
//   op 'check' {chatId} = 봇이 그 방에 있는지(글 안 올림), op 'set' {dept, chatId, title} = 연결(dept '*' 는 기본 방), op 'off' {dept} = 끊기, op 'list' = 연결 목록
export async function reportRooms(body) {
  if (!process.env.TEACHERSQUARE_CRON_KEY || body.key !== process.env.TEACHERSQUARE_CRON_KEY) return { error: '권한이 없습니다.' };
  const op = String(body.op || 'list');
  if (op === 'candidates') {
    const token = process.env.TEACHERSQUARE_BOT_TOKEN;
    const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=${encodeURIComponent('["message","my_chat_member"]')}`);
    const j = await r.json();
    if (!j.ok) return { error: j.description || String(r.status) };
    const chats = {};
    for (const u of j.result) {
      const m = u.message || u.my_chat_member || {};
      if (m.chat && m.chat.type !== 'private') chats[m.chat.id] = { chatId: String(m.chat.id), title: m.chat.title || '', type: m.chat.type, status: u.my_chat_member ? u.my_chat_member.new_chat_member.status : '' };
    }
    return { rooms: Object.values(chats) };
  }
  if (op === 'envRooms') {   // 앱 봇들의 기본 방 이름(번호는 안 보임) — 어느 방이 무엇인지 확인용
    const out = [];
    for (const [tk, ck] of [['TEACHERSQUARE_BOT_TOKEN', 'TEACHERSQUARE_CHAT_ID'], ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'], ['ATT_BOT_TOKEN', 'ATT_ADMIN_CHAT']]) {
      const token = process.env[tk], chatId = process.env[ck];
      if (!token || !chatId) { out.push({ env: ck, set: false }); continue; }
      const j = await (await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`)).json().catch(() => ({}));
      const me = await (await fetch(`https://api.telegram.org/bot${token}/getMe`)).json().catch(() => ({}));
      // 출석 봇(보고방 봇)이 그 방에도 있는지
      const att = process.env.ATT_BOT_TOKEN ? await (await fetch(`https://api.telegram.org/bot${process.env.ATT_BOT_TOKEN}/getChat?chat_id=${encodeURIComponent(chatId)}`)).json().catch(() => ({})) : {};
      out.push({ env: ck, bot: me.result && me.result.username, title: j.ok ? j.result.title : j.description, forum: j.ok ? !!j.result.is_forum : undefined, attBotIn: !!att.ok });
    }
    return { rooms: out };
  }
  if (op === 'admins') {   // 방 관리자 목록(다른 봇이 있는지 보기용, 글 안 올림)
    const j = await (await fetch(`https://api.telegram.org/bot${botToken()}/getChatAdministrators?chat_id=${encodeURIComponent(String(body.chatId || ''))}`)).json().catch(() => ({}));
    return j.ok ? { admins: j.result.map((a) => ({ name: [a.user.first_name, a.user.last_name].filter(Boolean).join(' '), username: a.user.username || '', bot: a.user.is_bot })) } : { error: j.description };
  }
  if (op === 'check') {   // 글을 올리지 않고 봇이 그 방에 있는지·글을 쓸 수 있는지만 본다
    // 앱의 봇 셋(교사광장·출석·활동 알림)을 모두 본다 — 다른 봇을 초대했는지도 알 수 있게
    const chatId = String(body.chatId || '');
    const out = [];
    for (const token of [process.env.TEACHERSQUARE_BOT_TOKEN, process.env.ATT_BOT_TOKEN, process.env.TELEGRAM_BOT_TOKEN].filter(Boolean)) {
      const tg = async (m, q) => (await fetch(`https://api.telegram.org/bot${token}/${m}?${new URLSearchParams(q)}`)).json();
      const me = await tg('getMe', {});
      const chat = await tg('getChat', { chat_id: chatId });
      const member = me.ok ? await tg('getChatMember', { chat_id: chatId, user_id: me.result.id }) : {};
      out.push({ bot: me.result && me.result.username, chat: chat.ok ? { title: chat.result.title, type: chat.result.type, forum: !!chat.result.is_forum } : chat.description,
        member: member.ok ? { status: member.result.status, canPost: member.result.can_send_messages !== false } : member.description });
    }
    return { bots: out };
  }
  if (op === 'audit') {   // 10/29: 방마다 연결 점검(글 안 올림) — 봇 상태·주제·방 인원·명단 인원·최근 보고·최근 22시 보고 {prefix?}
    const pre = String(body.prefix || '');
    const rooms = (await run(db().from('report_rooms').select('*').eq('active', true).order('dept'))).filter((r) => !pre || r.dept.startsWith(pre));
    const roster = await loadRoster();
    const acts = await run(db().from('activities').select('tg_posts, submitted_at').gte('submitted_at', `${kstDate().slice(0, 8)}01 00:00:00`).not('tg_posts', 'is', null));
    const lastPost = {};
    for (const a of acts) for (const p of a.tg_posts || []) if (!lastPost[p.chat] || p.at > lastPost[p.chat]) lastPost[p.chat] = p.at;
    const logs = await run(db().from('cohort_summary_log').select('ref_id, date').eq('cohort_id', '#report-room').order('date', { ascending: false }).limit(500));
    const out = [];
    for (const r of rooms) {
      const t = target(r.chat_id), token = tokenFor(r.chat_id);
      const get = async (m, q) => (await fetch(`https://api.telegram.org/bot${token}/${m}?${new URLSearchParams(q)}`)).json().catch(() => ({}));
      const chat = await get('getChat', { chat_id: t.chat_id });
      const me = await get('getMe', {});
      const mem = me.ok ? await get('getChatMember', { chat_id: t.chat_id, user_id: me.result.id }) : {};
      const cnt = await get('getChatMemberCount', { chat_id: t.chat_id });
      const [d, reg] = r.dept.split('#')[0].split('/');
      const n = r.dept.includes('#') ? null : roster.filter((x) => String(x.dept || '').trim() === d && (!reg || regionRoomKey(x) === r.dept)).length;
      out.push({ dept: r.dept, title: r.title, chatId: r.chat_id, ok: !!chat.ok, error: chat.ok ? undefined : chat.description, forum: chat.ok ? !!chat.result.is_forum : undefined,
        topic: t.message_thread_id || null, bot: mem.ok ? mem.result.status : mem.description, canPost: mem.ok ? mem.result.can_send_messages !== false : false,
        members: cnt.ok ? cnt.result : null, countError: cnt.ok ? undefined : cnt.description, movedTo: (cnt.parameters && cnt.parameters.migrate_to_chat_id) ? String(cnt.parameters.migrate_to_chat_id) : undefined, roster: n, lastPost: lastPost[String(r.chat_id)] || '', lastDaily: (logs.find((l) => l.ref_id === r.dept) || {}).date || '' });
    }
    return { rooms: out };
  }
  if (op === 'setName') {   // 보고방에 들어간 봇(출석 봇)의 보이는 이름 — 10/23 사용자: "교사광장 도우미"
    const name = String(body.name || '').trim().slice(0, 64);
    if (!name) return { error: 'name 이 필요합니다.' };
    const r = await fetch(`https://api.telegram.org/bot${process.env.ATT_BOT_TOKEN}/setMyName`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    const j = await r.json();
    const me = await (await fetch(`https://api.telegram.org/bot${process.env.ATT_BOT_TOKEN}/getMe`)).json();
    return { ok: !!j.ok, error: j.ok ? undefined : j.description, name: me.result && me.result.first_name, username: me.result && me.result.username };
  }
  if (op === 'daily') {   // 일일 보고 미리 보기 {date?, dept?} — send:true 면 그 방에 바로 보낸다(22시 자동과 별개)
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) ? String(body.date) : kstDate();
    const key = String(body.dept || '');
    const list = key.includes('#') ? await buildSummaryReports(date, key) : [...await buildDailyReports(date, key), ...(key ? [] : await buildSummaryReports(date))];
    const pre = body.label ? `🧪 <b>${esc(String(body.label).slice(0, 60))}</b>\n` : '';   // 시험 보내기 표시(예: '샘플')
    if (body.send) for (const r of list) await sendDaily(r, pre);
    return { date, reports: list.map((r) => ({ dept: r.room.dept, title: r.room.title, count: r.count, text: r.text, via: r.via || (body.send ? '글' : ''), photoError: r.photoError })), sent: !!body.send };
  }
  if (op === 'set') {
    const dept = String(body.dept || '').trim(), chatId = String(body.chatId || '').trim();
    if (!dept || !/^-?\d+$/.test(chatId)) return { error: 'dept, chatId 가 필요합니다.' };
    await run(db().from('report_rooms').upsert({ dept, chat_id: chatId, title: String(body.title || ''), active: true, created_at: kstDateTime() }));
  } else if (op === 'off') {
    await run(db().from('report_rooms').update({ active: false }).eq('dept', String(body.dept || '')));
  }
  return { rooms: await run(db().from('report_rooms').select('*').order('dept')) };
}

// ── 관리자 탭 '보고방' (2026-10-25) ── 사용자: "관리자 탭에서 받은 방 번호를 등록하면 그 방하고 연결되게".
//   운영 키 대신 앱 관리자(교육·전도 담당) 로그인으로. 방 열쇠 = 교사명단의 부서('교역자') 또는 '부서/지역'('부녀회/03지역').
//   op 'list' = 연결 목록 + 명단에 있는 부서·지역 칸, op 'set' {dept, region?, chatId} = 봇이 그 방에 있는지 보고 연결 + 방에 확인 글,
//   op 'off' {key} = 연결 끊기(그 방 사람 보고는 부서 방 → 기본 방으로).
export async function reportRoomsAdmin(body) {
  if (!(await isApprover(body.memberId))) return { error: '보고방은 교육·전도 담당 관리자만 연결할 수 있어요.' };
  const op = String(body.op || 'list');
  if (op === 'set') {
    const dept = String(body.dept || '').trim(), region = String(body.region || '').trim();
    let chatId = String(body.chatId || '').replace(/\s/g, '');
    if (!dept) return { error: '부서를 골라 주세요.' };
    if (!/^-\d+$/.test(chatId)) return { error: '방 번호는 -100… 처럼 빼기(-)로 시작하는 숫자예요.' };
    const key = region ? `${dept}/${region}` : dept;
    // 일반 그룹이 슈퍼그룹으로 바뀌면 번호가 새로 생긴다 — 방 찾기·확인 글 어느 쪽에서 알려 주든 텔레그램이 준 새 번호로 한 번 더
    const moved = async (fn) => { try { return await fn(); } catch (e) { if (!e.migrateTo) throw e; chatId = String(e.migrateTo); return fn(); } };
    let chat;
    try { chat = await moved(() => tg('getChat', { chat_id: chatId })); }
    catch (e) { return { error: `봇이 그 방을 찾지 못했어요(${e.message}). 방에 '교사광장 도우미' 봇을 초대했는지, 번호가 맞는지 확인해 주세요.` }; }
    const title = chat.title || key;
    const label = region ? `${deptLabelOf(dept)} ${regionOf({ region }) || region}` : deptLabelOf(dept);
    try { await moved(() => sendText(chatId, `✅ 이 방이 <b>${esc(label)}</b> 보고방으로 연결됐어요.\n교사가 활동 보고를 올리면 이 방으로 오고, 매일 22시에 일일 보고가 모여 올라와요.`)); }
    catch (e) { return { error: `방은 찾았지만 글을 올리지 못했어요(${e.message}). 봇이 글을 쓸 수 있게 권한을 확인해 주세요.` }; }
    await run(db().from('report_rooms').upsert({ dept: key, chat_id: chatId, title, active: true, created_at: kstDateTime() }));
  } else if (op === 'off') {
    await run(db().from('report_rooms').update({ active: false }).eq('dept', String(body.key || '')));
  }
  const [rooms, roster] = await Promise.all([run(db().from('report_rooms').select('*').order('dept')), loadRoster()]);
  // 명단에 있는 부서·지역(사람 수) — 화면의 고르기 칸. 교역자처럼 지역 없이 쓰는 부서도 부서 칸은 나온다.
  const slots = {};
  for (const t of roster) {
    const d = String(t.dept || '').trim(); if (!d) continue;
    const r = t.region ? regionRoomKey(t).split('/')[1] : '';   // 청년회 새신자 → 기타(같은 방)
    slots[d] = slots[d] || { dept: d, n: 0, regions: {} };
    slots[d].n++;
    if (r) slots[d].regions[r] = (slots[d].regions[r] || 0) + 1;
  }
  return {
    rooms: rooms.map((r) => ({ key: r.dept, chatId: r.chat_id, title: r.title, active: r.active, at: r.created_at || '' })),
    depts: Object.values(slots).map((s) => ({ dept: s.dept, n: s.n, regions: Object.entries(s.regions).map(([region, n]) => ({ region, n })).sort((a, b) => a.region.localeCompare(b.region, 'ko', { numeric: true })) })),
  };
}
