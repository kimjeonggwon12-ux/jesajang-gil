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
import { toCohort, assignmentOn, isLate, weekdayOf } from '../lib/cohort.js';
import { toAssignment, toExam, loadAll, sendBoard } from './cohorts.js';
import { scoreBoard } from '../lib/cohort-tables.js';

/** 과목 순위표 이미지를 방으로 */
async function sendRanking(c, subject) {
  try { const b = scoreBoard(await loadAll(c), subject, 12, c.title); if (b) await sendBoard(c, b); } catch (e) { console.log('순위표 오류: ' + e); }
}
import { isOwner } from './roster.js';

const APP_URL = () => process.env.APP_URL || 'https://jesajang-gil.vercel.app';
/** 텔레그램이 웹훅 머리글에 실어 보내는 비밀값(크론 키에서 만든다 — 따로 환경값을 늘리지 않으려고). */
export const webhookSecret = () => crypto.createHash('sha256').update(String(process.env.TEACHERSQUARE_CRON_KEY || '') + '|att-tg').digest('hex').slice(0, 48);

const mmdd = (d) => String(d).slice(5).replace('-', '/');
const nameKey = (s) => String(s == null ? '' : s).replace(/\s/g, '');
const HELP = [
  '📘 교육 방 사용법',
  '• 과제 제출: 제출 홍길동 내용…  (처음 한 번만 이름, 다음부터는 "제출 내용"만)',
  '  사진·파일을 올릴 때 설명에 "제출 홍길동"이라고 써도 됩니다.',
  '  과제가 여러 개면 과제 낱말을 앞에: 제출 항해자 내용… / 제출 노트 내용…',
  '  지난날 것은: 제출 어제 항해자 내용…  또는  제출 10/15 노트 내용…',
  '• 시험 점수(방 관리자): 점수 계시록 홍길동 85 김영희 90',
  '  날짜를 넣으려면: 점수 계시록 10/16 홍길동 85  (없으면 오늘)',
  '  여러 줄로 써도 됩니다(첫 줄 "점수 과목", 다음 줄부터 "이름 점수").',
  '• 여러 날 점수를 표로(방 관리자):',
  '  점수 계시록',
  '  10.12 / 14/15/16',
  '  1. 홍길동 80/ 90/ 미/ 100   (미 = 미응시)',
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

const loadMembers = (cohortId) => run(db().from('cohort_members').select('*').eq('cohort_id', cohortId).order('seq').order('id'));

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
// 2026-10-16(2차): 과제가 여러 개(천국 가는 항해자·노트 정리 …)이고 매일/요일 반복 — 제출은 날짜마다 따로.
//   제출 [어제|10/15] [이름] [과제 낱말] 내용   (순서: 날짜 → 이름 → 과제, 날짜·이름·과제는 없어도 됨)

/** 글 앞의 "어제"·"그제"·"10/15" → 날짜(반복 과제를 늦게 낼 때). */
function dateAtStart(text) {
  const t = text.trimStart();
  const today = kstDate();
  const back = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  let m = /^(어제|그제|그저께)(?=\s|$)/.exec(t);
  if (m) return { date: back(m[1] === '어제' ? 1 : 2), rest: t.slice(m[0].length).trimStart() };
  m = /^(\d{1,2})[/.](\d{1,2})(?=\s|$)/.exec(t);
  if (m) {
    const d = `${today.slice(0, 4)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    if (d <= today) return { date: d, rest: t.slice(m[0].length).trimStart() };
  }
  return null;
}

/** 글 앞에서 과제를 찾는다: 과제 이름 전체, 또는 첫 낱말이 이름에 들어 있는 과제가 하나뿐일 때. */
function assignmentAtStart(text, list) {
  const t = text.trimStart();
  for (const a of [...list].sort((x, y) => nameKey(y.title).length - nameKey(x.title).length)) {
    const want = nameKey(a.title);
    if (!want || !nameKey(t).startsWith(want)) continue;
    let k = 0, i = 0;   // 제목 글자 수만큼(띄어쓰기 무시) 앞을 떼어 낸다
    while (i < t.length && k < want.length) { if (!/\s/.test(t[i])) k++; i++; }
    return { a, rest: t.slice(i).replace(/^[\s:：,·-]+/, '') };
  }
  const word = (/^(\S{2,})/.exec(t) || [])[1];
  if (word) {
    const hits = list.filter((a) => nameKey(a.title).includes(nameKey(word)));
    if (hits.length === 1) return { a: hits[0], rest: t.slice(word.length).replace(/^[\s:：,·-]+/, '') };
  }
  return null;
}

async function onSubmit(msg, c, body) {
  const members = await loadMembers(c.cohortId);
  const uid = String(msg.from.id);
  const today = kstDate();
  let rest = body;
  const dated = dateAtStart(rest);
  if (dated) rest = dated.rest;
  const workDay = dated ? dated.date : today;

  // 누구인가: 글 앞 이름 → (없으면) 연결된 텔레그램 계정 → 텔레그램 이름
  let member = null;
  const byName = nameAtStart(rest, members);
  if (byName) {
    member = byName.member; rest = byName.rest;
    const { error } = await db().from('cohort_tg_links').upsert(
      { cohort_id: c.cohortId, tg_user_id: uid, member_id: member.member_id, name: member.name, linked_at: kstDateTime() },
      { onConflict: 'cohort_id,tg_user_id' });
    if (error) console.log('텔레그램 연결 저장 오류: ' + error.message);
  } else {
    const [link] = await run(db().from('cohort_tg_links').select('*').eq('cohort_id', c.cohortId).eq('tg_user_id', uid).limit(1));
    if (link) member = members.find((m) => m.nid === link.nid) || null;
    if (!member) member = members.find((m) => nameKey(m.name) === nameKey(tgName(msg.from))) || null;
  }
  if (!member) return reply(msg, '누구신지 아직 몰라요. 처음 한 번은 "제출 홍길동 항해자 내용"처럼 이름을 함께 써 주세요.\n(교육생 명단에 없는 이름이면 관리자에게 등록을 부탁하세요)');

  // 어떤 과제인가: 그날 낼 수 있는 과제(반복 과제는 그날 요일, 한번 과제는 열려 있는 것) 중에서
  const open = (await run(db().from('cohort_assignments').select('*').eq('cohort_id', c.cohortId).eq('status', '열림').order('id'))).map(toAssignment);
  const usable = open.filter((a) => (a.repeat === '한번' ? !dated : assignmentOn(a, workDay)));
  let a = null;
  const picked = assignmentAtStart(rest, usable);
  if (picked) { a = picked.a; rest = picked.rest; }
  else if (usable.length === 1) a = usable[0];
  else if (usable.length > 1) {
    const hint = usable.map((x) => `• 제출 ${x.title.split(/\s+/).at(-1)} 내용…  (${x.title})`).join('\n');
    return reply(msg, `어느 과제인지 알려 주세요. 과제 이름의 한 낱말을 앞에 써 주시면 됩니다.\n${hint}`);
  } else if (!open.length) {
    // 과제를 하나도 안 만들었으면 그날 날짜 과제를 만든다
    const row = { assignment_id: newId('AS'), cohort_id: c.cohortId, title: `${mmdd(today)} 과제`, guide: '텔레그램 제출로 자동 생성', due: today, status: '열림', repeat: '한번', days: '', due_time: '', created_at: kstDateTime() };
    await run(db().from('cohort_assignments').insert(row));
    a = toAssignment(row);
  } else return reply(msg, `${mmdd(workDay)}(${weekdayOf(workDay)})에는 낼 과제가 없어요.`);

  const repeat = a.repeat !== '한번';
  const workDate = repeat ? workDay : '';
  const now = kstDateTime();
  const late = (repeat && workDay < today) || isLate(a, now);
  const file = msg.photo ? msg.photo.at(-1).file_id : msg.document ? msg.document.file_id : '';
  const attach = msg.photo ? '[사진]' : msg.document ? `[파일 ${msg.document.file_name || ''}]` : '';
  const content = clip([rest.trim(), attach].filter(Boolean).join('\n'), 4000) || '(내용 없음)';
  const [had] = await run(db().from('cohort_submissions').select('id').eq('assignment_id', a.assignmentId).eq('nid', member.nid).eq('work_date', workDate).limit(1));
  if (had) {
    await run(db().from('cohort_submissions').update({ content, updated_at: now, source: '텔레그램', ...(file ? { tg_file: file } : {}) }).eq('id', had.id));
  } else {
    const { error } = await db().from('cohort_submissions').insert({
      assignment_id: a.assignmentId, cohort_id: c.cohortId, member_id: member.member_id, name: member.name,
      content, submitted_at: now, updated_at: now, source: '텔레그램', tg_file: file, work_date: workDate, late,
    });
    if (error && !isDuplicate(error)) throw new Error(error.message);
  }
  const { count } = await db().from('cohort_submissions').select('*', { count: 'exact', head: true }).eq('assignment_id', a.assignmentId).eq('work_date', workDate);
  const when = repeat ? ` ${mmdd(workDay)}(${weekdayOf(workDay)})` : '';
  return reply(msg, `📝 ${member.name}${member.church ? '(' + member.church + ')' : ''} · ${a.title}${when} ${had ? '다시 제출' : '제출'} 기록${late ? ' · ⏰ 늦게 냄' : ''}\n제출 ${count || 0}/${members.length}명`);
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

// ── 날짜별 점수 표 ── (2026-10-16 사용자가 실제로 올린 모양)
//   점수 [과목]
//   10.12 / 14/15/16          ← 날짜 줄(첫 날짜에 월, 나머지는 일만 / "10/12, 10/14" / "10/12/14/15/16"도 됨)
//   1. 전용완 0/ 40/ 20/ 60    ← 이름 + 날짜 순서대로 점수, "미"·"-"·"x" = 미응시
const SKIP_WORDS = /날짜별|시험\s*결과|결과|성적|점수표|점수/g;

/** 날짜 줄 → ['yyyy-MM-dd', …] (날짜 줄이 아니면 []) */
export function parseDateList(line, today) {
  const t = String(line).trim();
  if (!/\d/.test(t) || !/^[\d\s./,，·\-월일()화수목금토]+$/.test(t)) return [];
  const year = today.slice(0, 4);
  const ok = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31;
  const fmt = (m, d) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const out = [];
  if (/[.월]/.test(t)) {
    let month = 0;
    for (const tok of t.match(/\d{1,2}\s*[.월]\s*\d{1,2}|\d{1,2}/g) || []) {
      const md = /^(\d{1,2})\s*[.월]\s*(\d{1,2})$/.exec(tok);
      if (md) { month = +md[1]; if (ok(month, +md[2])) out.push(fmt(month, +md[2])); } else if (month && ok(month, +tok)) out.push(fmt(month, +tok));
    }
  } else if (/[,，]/.test(t)) {
    let month = 0;
    for (const part of t.split(/[,，]/)) {
      const md = /(\d{1,2})\s*\/\s*(\d{1,2})/.exec(part), d = /(\d{1,2})/.exec(part);
      if (md) { month = +md[1]; if (ok(month, +md[2])) out.push(fmt(month, +md[2])); } else if (d && month && ok(month, +d[1])) out.push(fmt(month, +d[1]));
    }
  } else {
    const nums = (t.match(/\d{1,2}/g) || []).map(Number);   // "10/12/14/15/16" = 10월 12·14·15·16일
    if (nums.length >= 2 && nums[0] <= 12) for (const d of nums.slice(1)) if (ok(nums[0], d)) out.push(fmt(nums[0], d));
  }
  return [...new Set(out)];
}

/** 표 모양이면 { dates, rows:[{name, values}], rest } (아니면 null). values 의 null = 미응시 */
export function parseScoreTable(body, today) {
  const lines = String(body).split('\n');
  let dates = [], dateLine = -1;
  lines.forEach((l, i) => { if (dateLine < 0) { const d = parseDateList(l, today); if (d.length) { dates = d; dateLine = i; } } });
  const rows = [], rest = [];
  lines.forEach((l, i) => {
    if (i === dateLine) return;
    const m = /^\s*(?:\d+\s*[.)]\s*)?([가-힣A-Za-z]{2,10})\s*[:：]?\s+([\d미xX\-–./\s점]+)$/.exec(l);
    if (m && /[/]/.test(m[2])) {
      const values = m[2].split('/').map((v) => v.replace(/점/g, '').trim()).filter((v, k, arr) => v !== '' || k < arr.length - 1)
        .map((v) => (/^\d{1,3}(?:\.\d{1,2})?$/.test(v) ? Number(v) : null));
      rows.push({ name: m[1], values });
    } else rest.push(l);
  });
  if (!rows.length) return null;
  return { dates, rows, rest: rest.join(' ') };
}

async function onScoreTable(msg, c, members, byName, table) {
  const { dates, rows } = table;
  const width = Math.max(...rows.map((r) => r.values.length));
  if (!dates.length) return reply(msg, `날짜 줄을 찾지 못했어요. 이름 아래 점수가 ${width}개면 날짜도 ${width}개 적어 주세요.\n예:\n점수 계시록\n10.12 / 14/15/16\n1. 홍길동 80/ 90/ 미/ 100`);
  if (width > dates.length) return reply(msg, `날짜는 ${dates.length}개(${dates.map((d) => d.slice(5).replace('-', '/')).join('·')})인데 점수가 ${width}개인 줄이 있어요. 날짜 줄을 확인해 주세요.`);
  // 과목: 남은 글에서 교육생 이름·'날짜별 시험 결과' 같은 말을 뺀 것 → 시험 루틴 과목에 맞춤, 없으면 루틴이 하나뿐일 때 그 과목
  const routines = (await run(db().from('cohort_exams').select('*').eq('cohort_id', c.cohortId).neq('status', '삭제'))).map(toExam);
  const leftover = table.rest.replace(SKIP_WORDS, ' ').split(/\s+/).filter((w) => w && !byName.has(nameKey(w)) && nameKey(w) !== nameKey(tgName(msg.from))).join(' ').trim();   // 교육생 이름·올린 사람 이름은 과목이 아님
  let subject = '';
  if (leftover) {
    const hit = routines.find((e) => nameKey(e.subject) === nameKey(leftover)) || routines.find((e) => nameKey(e.subject).includes(nameKey(leftover)) || nameKey(leftover).includes(nameKey(e.subject)));
    subject = hit ? hit.subject : clip(leftover, 40);
  } else if (routines.filter((e) => e.status === '열림').length === 1) subject = routines.find((e) => e.status === '열림').subject;
  else if (routines.length === 1) subject = routines[0].subject;
  if (!subject) return reply(msg, `어느 과목 점수인지 알려 주세요. 첫 줄에 과목을 써 주시면 됩니다.\n예: 점수 ${routines[0]?.subject || '계시록'}\n(시험 루틴: ${routines.map((e) => e.subject).join(', ') || '없음'})`);

  const now = kstDateTime(), by = tgName(msg.from);
  const save = [], unknown = [], dup = [], absent = [];
  for (const r of rows) {
    const m = byName.get(nameKey(r.name));
    if (!m) { unknown.push(r.name); continue; }
    if (m === 'dup') { dup.push(r.name); continue; }
    r.values.forEach((v, k) => {
      if (v == null || v > 1000) { absent.push(`${m.name} ${dates[k].slice(5).replace('-', '/')}`); return; }
      save.push({ cohort_id: c.cohortId, date: dates[k], subject, member_id: m.member_id, name: m.name, score: v, by_name: by, at: now });
    });
  }
  if (save.length) await run(db().from('cohort_scores').upsert(save, { onConflict: 'cohort_id,date,subject,nid' }));
  const perDate = dates.map((d) => `${d.slice(5).replace('-', '/')} ${save.filter((s) => s.date === d).length}명`);
  const lines = [`📊 ${subject} 날짜별 점수 ${save.length}개 기록 (교육생 ${members.length}명)`, perDate.join(' · ')];
  if (absent.length) lines.push('🔸 미응시: ' + absent.join(', '));
  const listed = new Set(rows.map((r) => nameKey(r.name)));
  const notListed = members.filter((m) => !listed.has(nameKey(m.name)));
  if (notListed.length) lines.push('❔ 표에 없는 교육생: ' + notListed.map((m) => m.name).join(', '));
  if (unknown.length) lines.push('❓ 명단에 없는 이름: ' + unknown.join(', '));
  if (dup.length) lines.push('⚠️ 같은 이름이 둘 이상이라 못 넣음: ' + dup.join(', '));
  await reply(msg, lines.join('\n'));
  return sendRanking(c, subject);   // 점수가 들어올 때마다 순위표(이미지)
}

async function onScore(msg, c, body) {
  if (!(await isChatAdmin(msg.chat.id, msg.from.id))) return reply(msg, '점수는 방 관리자만 올릴 수 있어요.');
  const members = await loadMembers(c.cohortId);
  const byName = new Map();
  for (const m of members) { const k = nameKey(m.name); byName.set(k, byName.has(k) ? 'dup' : m); }
  const table = parseScoreTable(body, kstDate());
  if (table) return onScoreTable(msg, c, members, byName, table);

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
  let subject = clip(words.join(' '), 40);
  // 시험 루틴 과목과 같거나(띄어쓰기 무시) 한쪽이 다른 쪽을 품으면 루틴 과목 이름으로 맞춘다 — 서머리가 같은 과목으로 모이게
  if (subject) {
    const routines = (await run(db().from('cohort_exams').select('*').eq('cohort_id', c.cohortId).neq('status', '삭제'))).map(toExam);
    const hit = routines.find((e) => nameKey(e.subject) === nameKey(subject)) || routines.find((e) => nameKey(e.subject).includes(nameKey(subject)) || nameKey(subject).includes(nameKey(e.subject)));
    if (hit) subject = hit.subject;
  }
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
  await reply(msg, lines.join('\n'));
  return sendRanking(c, subject);   // 점수가 들어올 때마다 순위표(이미지)
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
    const { cohortSummaryText, sendBoards } = await import('./cohorts.js');
    await reply(msg, await cohortSummaryText(c));
    return sendBoards(c);   // 출석표·과목별 순위표 이미지
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
