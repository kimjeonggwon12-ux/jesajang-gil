// 교육 과정 텔레그램 방(출석 봇 웹훅): 방에 쓴 글로 과제 제출·시험 점수를 기록한다.
//   제출 [이름] [과제이름] 내용     → 과제 제출(처음 한 번 이름을 쓰면 그 텔레그램 계정이 교육생과 연결됨, 사진·파일 설명에 써도 됨)
//   점수 과목 [날짜] 이름 점수 …    → 그날 그 과목 점수(방 관리자만). 한 줄에 여럿 또는 여러 줄.
//   집계 · 방번호 · 도움말
// ⚠️ 봇이 '제출'·'점수' 같은 일반 글을 받으려면 봇을 그 방의 관리자로 지정해야 한다(텔레그램 개인정보 모드).
import crypto from 'node:crypto';
import { db, run, isDuplicate } from '../lib/db.js';
import { normId, kstDate, kstDateTime } from '../lib/util.js';
import { clip, newId } from '../lib/input.js';
import { attendBotCall } from '../lib/attend-bot.js';
import { toCohort } from '../lib/cohort.js';
import { isOwner } from './roster.js';

const APP_URL = () => process.env.APP_URL || 'https://jesajang-gil.vercel.app';
/** 텔레그램이 웹훅 머리글에 실어 보내는 비밀값(크론 키에서 만든다 — 따로 환경값을 늘리지 않으려고). */
export const webhookSecret = () => crypto.createHash('sha256').update(String(process.env.TEACHERSQUARE_CRON_KEY || '') + '|att-tg').digest('hex').slice(0, 48);

const nameKey = (s) => String(s == null ? '' : s).replace(/\s/g, '');
const HELP = [
  '📘 교육 방 사용법',
  '• 과제 제출: 제출 홍길동 내용…  (처음 한 번만 이름, 다음부터는 "제출 내용"만)',
  '  사진·파일을 올릴 때 설명에 "제출 홍길동"이라고 써도 됩니다.',
  '  과제가 여러 개면: 제출 홍길동 1과요약 내용…',
  '• 시험 점수(방 관리자): 점수 계시록 홍길동 85 김영희 90',
  '  날짜를 넣으려면: 점수 계시록 10/16 홍길동 85  (없으면 오늘)',
  '  여러 줄로 써도 됩니다(첫 줄 "점수 과목", 다음 줄부터 "이름 점수").',
  '• 집계: 지금까지 출석·과제·점수 정리 (방 관리자)',
  '• 방번호: 이 방 번호 보기',
].join('\n');

const reply = (msg, text) => attendBotCall('sendMessage', {
  chat_id: msg.chat.id, text: String(text).slice(0, 3900), reply_to_message_id: msg.message_id, allow_sending_without_reply: true,
});
const tgName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.username || '';

async function isChatAdmin(chatId, userId) {
  const r = await attendBotCall('getChatMember', { chat_id: chatId, user_id: userId });
  return r.ok && ['creator', 'administrator'].includes(r.result?.status);
}

async function cohortOfChat(chatId) {
  const [row] = await run(db().from('cohorts').select('*').eq('tg_chat', String(chatId)).eq('status', '진행').order('id', { ascending: false }).limit(1));
  return row ? toCohort(row) : null;
}

const loadMembers = (cohortId) => run(db().from('cohort_members').select('*').eq('cohort_id', cohortId));

/** 글 앞쪽에서 교육생 이름을 찾는다(긴 이름부터). 찾으면 { member, rest }. */
function nameAtStart(text, members) {
  const t = text.trimStart();
  const sorted = [...members].sort((a, b) => nameKey(b.name).length - nameKey(a.name).length);
  for (const m of sorted) {
    const n = String(m.name).trim();
    if (n && t.startsWith(n)) return { member: m, rest: t.slice(n.length).replace(/^[\s:：,·-]+/, '') };
  }
  return null;
}

// ── 과제 제출 ──

async function onSubmit(msg, c, body) {
  const members = await loadMembers(c.cohortId);
  const uid = String(msg.from.id);
  let member = null;
  let rest = body;
  const byName = nameAtStart(body, members);
  if (byName) {
    member = byName.member; rest = byName.rest;
    const { error } = await db().from('cohort_tg_links').upsert(
      { cohort_id: c.cohortId, tg_user_id: uid, member_id: member.member_id, name: member.name, linked_at: kstDateTime() },
      { onConflict: 'cohort_id,tg_user_id' });
    if (error) console.log('텔레그램 연결 저장 오류: ' + error.message);
  } else {
    const [link] = await run(db().from('cohort_tg_links').select('*').eq('cohort_id', c.cohortId).eq('tg_user_id', uid).limit(1));
    if (link) member = members.find((m) => m.nid === link.nid) || null;
    if (!member) member = members.find((m) => nameKey(m.name) === nameKey(tgName(msg.from))) || null;   // 텔레그램 이름이 교육생 이름과 같으면
  }
  if (!member) return reply(msg, '누구신지 아직 몰라요. 처음 한 번은 "제출 홍길동 내용"처럼 이름을 함께 써 주세요.\n(교육생 명단에 없는 이름이면 관리자에게 등록을 부탁하세요)');

  // 과제 고르기: 글 앞이 과제 이름이면 그 과제, 아니면 가장 최근 열린 과제, 없으면 오늘 날짜 과제를 만든다.
  const open = await run(db().from('cohort_assignments').select('*').eq('cohort_id', c.cohortId).eq('status', '열림').order('id', { ascending: false }));
  let a = [...open].sort((x, y) => nameKey(y.title).length - nameKey(x.title).length)
    .find((x) => nameKey(rest).startsWith(nameKey(x.title)) && nameKey(x.title));
  if (a) {
    // 제목 글자 수만큼(띄어쓰기 무시) 앞을 떼어 낸다
    let k = 0, i = 0;
    const want = nameKey(a.title).length;
    while (i < rest.length && k < want) { if (!/\s/.test(rest[i])) k++; i++; }
    rest = rest.slice(i).replace(/^[\s:：,·-]+/, '');
  } else a = open[0];
  const today = kstDate();
  if (!a) {
    const title = `${today.slice(5).replace('-', '/')} 과제`;
    const row = { assignment_id: newId('AS'), cohort_id: c.cohortId, title, guide: '텔레그램 제출로 자동 생성', due: today, status: '열림', created_at: kstDateTime() };
    await run(db().from('cohort_assignments').insert(row));
    a = row;
  }

  const file = msg.photo ? msg.photo.at(-1).file_id : msg.document ? msg.document.file_id : '';
  const attach = msg.photo ? '[사진]' : msg.document ? `[파일 ${msg.document.file_name || ''}]` : '';
  const content = clip([rest.trim(), attach].filter(Boolean).join('\n'), 4000) || '(내용 없음)';
  const now = kstDateTime();
  const [had] = await run(db().from('cohort_submissions').select('id').eq('assignment_id', a.assignment_id).eq('nid', member.nid).limit(1));
  if (had) {
    await run(db().from('cohort_submissions').update({ content, updated_at: now, source: '텔레그램', ...(file ? { tg_file: file } : {}) }).eq('id', had.id));
  } else {
    const { error } = await db().from('cohort_submissions').insert({
      assignment_id: a.assignment_id, cohort_id: c.cohortId, member_id: member.member_id, name: member.name,
      content, submitted_at: now, updated_at: now, source: '텔레그램', tg_file: file,
    });
    if (error && !isDuplicate(error)) throw new Error(error.message);
  }
  const { count } = await db().from('cohort_submissions').select('*', { count: 'exact', head: true }).eq('assignment_id', a.assignment_id);
  const late = a.due && today > a.due ? ' · 기한 지남' : '';
  return reply(msg, `📝 ${member.name}${member.church ? '(' + member.church + ')' : ''} · ${a.title} ${had ? '다시 제출' : '제출'} 기록${late}\n제출 ${count || 0}/${members.length}명`);
}

// ── 시험 점수 ──

/** "10/16", "10.16", "2026-10-16" → 'yyyy-MM-dd' */
function readDate(tok) {
  const today = kstDate();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(tok);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.](\d{1,2})$/.exec(tok);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) return `${today.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return '';
}

async function onScore(msg, c, body) {
  if (!(await isChatAdmin(msg.chat.id, msg.from.id))) return reply(msg, '점수는 방 관리자만 올릴 수 있어요.');
  const members = await loadMembers(c.cohortId);
  const byName = new Map();
  for (const m of members) { const k = nameKey(m.name); byName.set(k, byName.has(k) ? 'dup' : m); }

  // 교육생 이름+점수 짝을 뽑아 첫 줄에서 지우고, 첫 줄에 남은 낱말 = 과목(+날짜)
  const pairRe = /([가-힣A-Za-z]{2,10})\s*[:：]?\s*(\d{1,3}(?:\.\d{1,2})?)(?![\d/.])\s*점?/g;
  const good = [], others = [];
  let head = body.split('\n')[0];
  for (const m of body.matchAll(pairRe)) {
    if (byName.has(nameKey(m[1]))) { good.push({ name: m[1], score: Number(m[2]) }); head = head.replace(m[0], ' '); continue; }
    // 명단에 없는 "이름 점수"도 첫 줄에서 뺀다 — 단, 첫 줄 맨 앞(과목 자리, 예: "계시록 10.16")은 그대로 둔다
    if (!head.trimStart().startsWith(m[0].trim()) || head.trim().split(/\s+/)[0] !== m[1]) { head = head.replace(m[0], ' '); others.push(m[1]); }
  }
  let date = '';
  const words = head.split(/\s+/).filter(Boolean).filter((w) => { const d = readDate(w); if (d && !date) { date = d; return false; } return true; });
  const subject = clip(words.join(' '), 40);
  const unknown = others.filter((n) => !words.includes(n)).map((name) => ({ name }));
  if (!subject) return reply(msg, '과목을 알 수 없어요. 예: 점수 계시록 홍길동 85 김영희 90');
  if (!good.length) return reply(msg, `${subject}: 교육생 이름과 점수를 찾지 못했어요.${unknown.length ? '\n명단에 없는 이름: ' + unknown.map((p) => p.name).join(', ') : ''}\n예: 점수 ${subject} 홍길동 85 김영희 90`);
  date = date || kstDate();

  const saved = [], dup = [];
  const rows = [];
  for (const p of good) {
    const m = byName.get(nameKey(p.name));
    if (m === 'dup') { dup.push(p.name); continue; }
    if (p.score > 1000) continue;
    rows.push({ cohort_id: c.cohortId, date, subject, member_id: m.member_id, name: m.name, score: p.score, by_name: tgName(msg.from), at: kstDateTime() });
    saved.push(`${m.name} ${p.score}`);
  }
  if (rows.length) await run(db().from('cohort_scores').upsert(rows, { onConflict: 'cohort_id,date,subject,nid' }));
  const { count } = await db().from('cohort_scores').select('*', { count: 'exact', head: true }).eq('cohort_id', c.cohortId).eq('date', date).eq('subject', subject);
  const lines = [`📊 ${subject} (${date.slice(5).replace('-', '/')}) 점수 ${rows.length}명 기록 — 입력 ${count || 0}/${members.length}명`, saved.join(', ')];
  if (unknown.length) lines.push('❓ 명단에 없는 이름: ' + unknown.map((p) => p.name).join(', '));
  if (dup.length) lines.push('⚠️ 같은 이름이 둘 이상이라 못 넣음: ' + dup.join(', '));
  return reply(msg, lines.join('\n'));
}

// ── 웹훅 진입 ──

/** 텔레그램이 보낸 업데이트 하나를 처리한다(api/tg.js 에서 부름). */
export async function handleAttendUpdate(update) {
  const added = update.my_chat_member;
  const msg = update.message || update.edited_message;
  const chat = (msg || added || {}).chat;
  if (!chat || chat.type === 'private') return;
  await run(db().from('cohort_tg_chats').upsert({ chat_id: String(chat.id), title: chat.title || '', seen_at: kstDateTime() }, { onConflict: 'chat_id' }));
  if (added && ['member', 'administrator'].includes(added.new_chat_member?.status) && !['member', 'administrator'].includes(added.old_chat_member?.status)) {
    await attendBotCall('sendMessage', { chat_id: chat.id, text: `안녕하세요! 이 방 번호는 ${chat.id} 입니다.\n앱의 교육 과정 설정에서 이 방을 고르면 출석·과제·점수가 이 방과 연결됩니다.\n⚠️ "제출"·"점수" 글을 읽으려면 저를 방 관리자로 지정해 주세요.` });
    return;
  }
  if (!msg || !msg.from || msg.from.is_bot) return;
  const text = String(msg.text || msg.caption || '').trim();
  if (/^\/?방번호/.test(text)) { await reply(msg, `이 방 번호: ${chat.id}`); return; }
  const c = await cohortOfChat(chat.id);
  if (!c) return;
  let m;
  if ((m = /^\/?제출\s*([\s\S]*)$/.exec(text))) return onSubmit(msg, c, m[1]);
  if ((m = /^\/?점수\s*([\s\S]*)$/.exec(text))) return onScore(msg, c, m[1]);
  if (/^\/?(도움말|사용법)$/.test(text)) return reply(msg, HELP);
  if (/^\/?집계$/.test(text)) {
    if (!(await isChatAdmin(chat.id, msg.from.id))) return reply(msg, '집계는 방 관리자만 볼 수 있어요.');
    const { cohortSummaryText } = await import('./cohorts.js');
    return reply(msg, await cohortSummaryText(c));
  }
}

// ── 관리 화면(7777) ──

const DENIED = { error: '교육 과정은 앱 관리자(7777)만 관리할 수 있어요.' };

/** 출석 봇이 이 서버로 글을 보내게 웹훅을 건다(처음 한 번 — 다시 눌러도 같음). */
async function cohortBotConnect(body) {
  if (!isOwner(clip(body.memberId, 40))) return DENIED;
  if (!process.env.TEACHERSQUARE_CRON_KEY) return { error: '서버 비밀값(크론 키)이 없어요.' };
  const r = await attendBotCall('setWebhook', {
    url: `${APP_URL()}/api/tg`, secret_token: webhookSecret(),
    allowed_updates: ['message', 'edited_message', 'my_chat_member'], drop_pending_updates: false,
  });
  if (!r.ok) return { error: r.description || '텔레그램 연결에 실패했어요.' };
  const info = await attendBotCall('getWebhookInfo');
  const me = await attendBotCall('getMe');
  return { ok: true, url: info.result?.url || '', pending: info.result?.pending_update_count || 0, lastError: info.result?.last_error_message || '', bot: me.result?.username || '' };
}

/** 봇이 본 방(최근 것부터). */
async function cohortChats(body) {
  if (!isOwner(clip(body.memberId, 40))) return DENIED;
  const rows = await run(db().from('cohort_tg_chats').select('*').order('seen_at', { ascending: false }).limit(30));
  const info = await attendBotCall('getWebhookInfo');
  return { chats: rows.map((r) => ({ id: r.chat_id, title: r.title })), connected: !!info.result?.url, lastError: info.result?.last_error_message || '' };
}

export default { cohortBotConnect, cohortChats };
