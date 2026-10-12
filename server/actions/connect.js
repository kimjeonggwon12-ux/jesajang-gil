// 연결: 명함 · 도와주세요 · 매칭 기록 · 교관 목록
import { db, run, selectAll, isDuplicate } from '../lib/db.js';
import { normId, kstDate, kstDateTime, fmtTs, sameId } from '../lib/util.js';
import { clip, pickList, newId, isDate } from '../lib/input.js';
import { afterAction } from '../lib/events.js';
import { teachersByNid, isOwner } from './roster.js';

const DEPTS = ['교', '자', '장', '부', '청'];
// ⚠️ app.html 의 역할·항목 목록과 같이 맞출 것.
const HELP_ROLES = ['인도자', '교사', '섬김이', '협력교사'];
const HELP_ITEMS = ['피드백', '섭외', '친분', '만남1', '만남2', '상담1', '상담2', '복음방', '동행교사', '센터소개', '센터수강'];
const HELP_COOP_ITEMS = ['동아리', '잎사귀', '만남 동행', '밭보기', '육상담', '부스담당', '은사', '멘토교사', '동행교사'];
const HELP_TYPES_LEGACY = ['동행 교사 필요', '복음방 진행자 필요', '상담 도움 필요', '기타'];

const CARD_ROLES = [...HELP_ROLES, ...HELP_ITEMS, ...HELP_COOP_ITEMS.filter((i) => !HELP_ITEMS.includes(i)),
  '피드백·상담', '만남·소개', '동행·코칭', '복음방 진행', '센터 인도', '기타'];
const CARD_LANGS = ['영어', '일본어', '중국어', '그 외'];
const CARD_TARGETS = ['청년 대상', '장년 대상', '부녀 대상', '자문 대상', '전 연령'];
const CARD_FIELDS = ['인문학', '노방 대상자 전문', '사주·타로', '애니어그램', '사군자', '디스크', '온라인 강의', '이단 시비 전문', '은사 전문', '찬양·음악', '운동'];
const SCHEDULES = ['언제나', '상의', '등록'];
const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const TIMES = ['오전', '오후', '저녁'];
const PHOTO_MAX = 45000;

const newestBy = (key) => (a, b) => (a[key] < b[key] ? 1 : -1);
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
const rosterFor = (rows) => teachersByNid(rows.map((r) => r.member_id));

// ── 명함 ──

function toCard(c, roster, viewerId) {
  const p = roster.get(normId(c.member_id)) || {};
  return {
    memberId: c.member_id, name: c.name || p.name || '', photoUrl: c.photo_url, phone: c.phone,
    intro: c.intro, career: c.career, hasMajor: c.has_major, majorName: c.major_name,
    cert: c.cert, oneLiner: c.one_liner,
    roles: c.roles, langs: c.langs, targets: c.targets, fields: c.fields, tools: c.tools,
    schedType: c.sched_type, from: c.from_date, to: c.to_date, days: c.days, times: c.times, schedNote: c.sched_note,
    dept: c.dept || p.dept || '', region: c.region || p.region || '', updatedAt: fmtTs(c.updated_at),
    tier: p.tier || '',
    expired: c.sched_type === '등록' && !!c.to_date && c.to_date < kstDate(),
    isMine: !!viewerId && sameId(c.member_id, viewerId),
  };
}

const allCards = () => selectAll(() => db().from('connect_cards').select('*').neq('member_id', '').order('id'));

/** 내 명함 저장. 같은 번호의 명함, 또는 이름+전화번호가 같은 명함이 있으면 그 하나로 합친다. */
async function saveConnectCard(body) {
  try {
    return await saveCardOnce(body);
  } catch (e) {
    // 두 기기에서 동시에 처음 저장한 경우: 두 번째는 방금 생긴 명함을 고친다.
    if (!isDuplicate(e)) throw e;
    return saveCardOnce(body);
  }
}

async function saveCardOnce(body) {
  const mid = clip(body.memberId, 40);
  const d = body.data || {};
  if (!mid) return { error: 'memberId 가 필요합니다.' };
  const roster = await teachersByNid([mid]);
  const p = roster.get(normId(mid)) || {};
  const name = clip(d.name, 30) || p.name || '';
  if (!name) return { error: '이름을 입력해주세요.' };
  const phone = clip(d.phone, 20);
  if (!phone) return { error: '전화번호를 입력해주세요.' };
  const schedType = SCHEDULES.includes(d.schedType) ? d.schedType : '';
  if (!schedType) return { error: '가능 일정을 선택해주세요.' };
  let schedule = { from_date: '', to_date: '', days: [], times: [], sched_note: '' };
  if (schedType === '등록') {
    const from = clip(d.from, 10);
    const to = clip(d.to, 10);
    if (!isDate(from) || !isDate(to)) return { error: '가능 기간(시작일~종료일)을 입력해주세요.' };
    if (to < from) return { error: '종료일은 시작일보다 빠를 수 없습니다.' };
    schedule = { from_date: from, to_date: to, days: pickList(d.days, DAYS), times: pickList(d.times, TIMES), sched_note: clip(d.schedNote, 60) };
  }
  const photo = String(d.photoUrl || '');
  const card = {
    member_id: mid, name, photo_url: photo.length > PHOTO_MAX ? '' : photo, phone,
    intro: clip(d.intro, 800), career: clip(d.career, 800), has_major: !!d.hasMajor, major_name: d.hasMajor ? clip(d.majorName, 40) : '',
    cert: clip(d.cert, 100), one_liner: clip(d.oneLiner, 80),
    roles: pickList(d.roles, CARD_ROLES), langs: pickList(d.langs, CARD_LANGS),
    targets: pickList(d.targets, CARD_TARGETS), fields: pickList(d.fields, CARD_FIELDS), tools: clip(d.tools, 100),
    sched_type: schedType, ...schedule, dept: p.dept || '', region: p.region || '', updated_at: kstDateTime(),
  };

  const phoneDigits = digits(phone);
  const hits = (await allCards()).filter((c) => sameId(c.member_id, mid)
    || (!!phoneDigits && c.name.trim() === name && digits(c.phone) === phoneDigits));
  // 합칠 때는 나머지를 먼저 지운다(한 사람에 명함 한 장 제약에 걸리지 않게).
  if (hits.length > 1) await run(db().from('connect_cards').delete().in('id', hits.slice(1).map((c) => c.id)));
  const saved = hits.length
    ? await run(db().from('connect_cards').update(card).eq('id', hits[0].id).select())
    : await run(db().from('connect_cards').insert(card).select());

  const result = { ok: true, ...(hits.length ? { updated: true } : {}), card: toCard(saved[0], roster, mid) };
  return afterAction('saveConnectCard', body, result);
}

async function getConnectCard(body) {
  const mid = clip(body.memberId, 40);
  const [cards, roster] = await Promise.all([
    run(db().from('connect_cards').select('*').eq('nid', normId(mid)).order('id')),
    teachersByNid([mid]),
  ]);
  const card = cards.find((c) => sameId(c.member_id, mid));
  if (card) return { card: toCard(card, roster, body.viewerId || mid) };
  const p = roster.get(normId(mid)) || {};
  return { card: null, name: p.name || '', dept: p.dept || '', region: p.region || '' };
}

/** 명함 찾기(최근 고친 순): 역할·지역·태그·일정·검색어로 거른다. */
async function searchConnectCards(body) {
  const me = clip(body.memberId, 40);
  const role = clip(body.role, 20);
  const region = clip(body.region, 20);
  const tag = clip(body.tag, 30);
  const schedule = clip(body.schedule, 10);
  const keyword = clip(body.keyword, 40).toLowerCase();
  const offset = Math.max(0, Number(body.offset || 0));
  const limit = Math.max(1, Math.min(100, Number(body.limit || 30)));

  const [cards, regionRows] = await Promise.all([
    allCards(),
    selectAll(() => db().from('teachers').select('region').neq('region', '').order('sort_order')),
  ]);
  const roster = await rosterFor(cards);
  const rows = cards.map((c) => toCard(c, roster, me)).filter((c) => {
    if (role && !c.roles.includes(role)) return false;
    if (region && c.region !== region) return false;
    if (tag && ![...c.targets, ...c.fields, ...c.langs, ...c.roles].includes(tag)) return false;
    if (schedule && (c.schedType !== schedule || (schedule === '등록' && c.expired))) return false;
    if (keyword && !`${c.name} ${c.oneLiner} ${c.intro} ${c.career} ${c.cert} ${c.tools} ${c.majorName}`.toLowerCase().includes(keyword)) return false;
    return true;
  }).sort(newestBy('updatedAt'));
  return {
    rows: rows.slice(offset, offset + limit), total: rows.length,
    regions: [...new Set(regionRows.map((t) => t.region))].sort(),
  };
}

async function deleteConnectCard(body) {
  const mid = clip(body.memberId, 40);
  const cards = await run(db().from('connect_cards').select('id, member_id').eq('nid', normId(mid)));
  const ids = cards.filter((c) => sameId(c.member_id, mid)).map((c) => c.id);
  if (ids.length) await run(db().from('connect_cards').delete().in('id', ids));
  return { ok: true };
}

// ── 도와주세요 ──

/** 요청 유형: "역할 · 항목" 꼴만 받는다(옛 유형 4가지는 그대로 통과). */
function helpType(raw) {
  const t = clip(raw, 40);
  if (!t) return '';
  if (HELP_TYPES_LEGACY.includes(t)) return t;
  const parts = t.split('·').map((s) => s.trim());
  if (parts.length !== 2) return '';
  const [role, item] = parts;
  if (!HELP_ROLES.includes(role)) return '';
  return (role === '협력교사' ? HELP_COOP_ITEMS : HELP_ITEMS).includes(item) ? `${role} · ${item}` : '';
}

function toHelp(h, roster, viewerId) {
  const p = roster.get(normId(h.member_id)) || {};
  return {
    helpId: h.help_id, memberId: h.member_id, name: h.name || p.name || '', type: h.type, dept: h.dept,
    startDate: h.start_date, endDate: h.end_date, oneLiner: h.one_liner, desc: h.description, status: h.status || '진행',
    target: h.target, need: h.need,
    createdAt: fmtTs(h.created_at), region: p.region || '',
    expired: !!h.end_date && h.end_date < kstDate(), isMine: !!viewerId && sameId(h.member_id, viewerId),
  };
}

const allHelps = () => selectAll(() => db().from('help_posts').select('*').order('id'));

async function saveHelpPost(body) {
  const mid = clip(body.memberId, 40);
  const d = body.data || {};
  if (!mid) return { error: 'memberId 가 필요합니다.' };
  const type = helpType(d.type);
  if (!type) return { error: '필요한 역할과 항목을 선택해주세요.' };
  const dept = clip(d.dept, 4);
  if (!DEPTS.includes(dept)) return { error: '부서(교/자/장/부/청)를 선택해주세요.' };
  const start = clip(d.startDate, 10);
  const end = clip(d.endDate, 10);
  if (!isDate(start)) return { error: '언제부터인지 날짜를 선택해주세요.' };
  if (!isDate(end)) return { error: '마감일을 선택해주세요.' };
  if (end < start) return { error: '마감일은 시작일보다 빠를 수 없습니다.' };
  const oneLiner = clip(d.oneLiner, 80);
  if (!oneLiner) return { error: '대상자 소개 한 마디를 입력해주세요.' };
  const content = {
    type, dept, start_date: start, end_date: end, one_liner: oneLiner,
    description: clip(d.desc, 1000), target: clip(d.target, 1000), need: clip(d.need, 1000),
  };

  const helpId = clip(d.helpId, 40);
  if (helpId) {
    const [row] = await run(db().from('help_posts').select('id, member_id').eq('help_id', helpId).limit(1));
    if (row && sameId(row.member_id, mid)) {
      await run(db().from('help_posts').update(content).eq('id', row.id));
      return afterAction('saveHelpPost', body, { ok: true, helpId });
    }
  }
  const fresh = newId('HP');
  await run(db().from('help_posts').insert({
    help_id: fresh, member_id: mid, name: clip(body.name, 30), ...content, status: '진행', created_at: kstDateTime(),
  }));
  return afterAction('saveHelpPost', body, { ok: true, helpId: fresh });
}

/** 진행 중인 글(+ 내 글은 마감·기한 지난 것도). includeClosed 면 전부. */
async function getHelpPosts(body) {
  const me = clip(body.memberId, 40);
  const type = clip(body.type, 20);
  const dept = clip(body.dept, 4);
  const helps = await allHelps();
  const roster = await rosterFor(helps);
  const rows = helps.map((h) => toHelp(h, roster, me)).filter((h) => {
    if (!body.includeClosed && (h.status !== '진행' || h.expired) && !h.isMine) return false;
    if (type && !h.type.includes(type)) return false;
    return !dept || h.dept === dept;
  }).sort(newestBy('createdAt'));
  return { rows };
}

const findHelp = async (helpId) => (await run(db().from('help_posts').select('id, member_id').eq('help_id', helpId).limit(1)))[0];

async function closeHelpPost(body) {
  const row = await findHelp(clip(body.helpId, 40));
  if (!row) return { error: '글을 찾지 못했습니다.' };
  if (!body.admin && !sameId(row.member_id, clip(body.memberId, 40))) return { error: '본인이 등록한 글만 마감할 수 있습니다.' };
  await run(db().from('help_posts').update({ status: '마감' }).eq('id', row.id));
  return { ok: true };
}

/** 영구 삭제 — 등록한 본인 또는 앱 관리자만. */
async function deleteHelpPost(body) {
  const helpId = clip(body.helpId, 40);
  const mid = clip(body.memberId, 40);
  if (!helpId || !mid) return { error: 'helpId, memberId 가 필요합니다.' };
  const row = await findHelp(helpId);
  if (!row) return { error: '글을 찾지 못했습니다.' };
  if (!isOwner(mid) && !sameId(row.member_id, mid)) return { error: '본인이 등록한 글만 삭제할 수 있습니다.' };
  await run(db().from('help_posts').delete().eq('id', row.id));
  return { ok: true };
}

// ── 매칭 기록 ── 명함·도와주세요에서 "연락하기"를 누른 흔적.

async function recordMatch(body) {
  const kind = body.kind === '도와주세요' ? '도와주세요' : '명함';
  const fromId = clip(body.fromId, 40);
  const toId = clip(body.toId, 40);
  const refId = clip(body.refId, 40);
  if (!fromId || !toId) return { error: 'fromId, toId 가 필요합니다.' };
  const same = await run(db().from('matches').select('from_id, to_id').eq('kind', kind).eq('ref_id', refId));
  if (same.some((m) => sameId(m.from_id, fromId) && sameId(m.to_id, toId))) return { ok: true, duplicate: true };
  await run(db().from('matches').insert({
    match_id: newId('MT'), kind, ref_id: refId, from_id: fromId, from_name: clip(body.fromName, 30),
    to_id: toId, to_name: clip(body.toName, 30), status: '요청', requested_at: kstDateTime(),
  }));
  return { ok: true };
}

async function setMatchDone(body) {
  const updated = await run(db().from('matches').update({ status: body.status === '성사' ? '성사' : '요청' })
    .eq('match_id', clip(body.matchId, 40)).select('id'));
  return updated.length ? { ok: true } : { error: '매칭을 찾지 못했습니다.' };
}

/** 관리자 연결 현황: 명함·도와주세요·매칭 전체와 요약 숫자(명함 사진은 뺀다 — 응답이 너무 커진다). */
async function getConnectAdminOverview() {
  const [cardRows, helpRows, matchRows] = await Promise.all([
    allCards(), allHelps(), selectAll(() => db().from('matches').select('*').order('id')),
  ]);
  const roster = await teachersByNid([...cardRows, ...helpRows].map((r) => r.member_id));
  const cards = cardRows.map((c) => ({ ...toCard(c, roster, ''), photoUrl: '' })).sort(newestBy('updatedAt'));
  const helps = helpRows.map((h) => toHelp(h, roster, '')).sort(newestBy('createdAt'));
  const matches = matchRows.map((m) => ({
    matchId: m.match_id, kind: m.kind, refId: m.ref_id, fromId: m.from_id, fromName: m.from_name,
    toId: m.to_id, toName: m.to_name, status: m.status, at: fmtTs(m.requested_at),
  })).sort(newestBy('at'));
  const helpByType = {};
  for (const h of helps) helpByType[h.type || '기타'] = (helpByType[h.type || '기타'] || 0) + 1;
  return {
    cards, helps, matches,
    stats: {
      cardCount: cards.length, helpCount: helps.length,
      helpOpen: helps.filter((h) => h.status === '진행' && !h.expired).length, helpByType,
      matchCount: matches.length, matchDone: matches.filter((m) => m.status === '성사').length,
    },
  };
}

// ── 교관 목록 ── 명단 직책이 '교관'인 사람 + 관리자 명단에서 직책에 '교관'이 들어간 사람(4개 부서만).

async function getCoachList(body) {
  const me = clip(body.memberId, 40);
  const COACH_DEPTS = ['자문회', '장년회', '부녀회', '청년회'];
  const [teachers, admins] = await Promise.all([
    run(db().from('teachers').select('member_id, name, dept, region').eq('position', '교관').order('sort_order')),
    run(db().from('admins').select('member_id, name, dept, region').like('position', '%교관%').order('id')),
  ]);
  const seen = new Set();
  const rows = [];
  for (const c of [...teachers, ...admins]) {
    const nid = normId(c.member_id);
    const dept = c.dept.trim();
    if (seen.has(nid) || (me && sameId(c.member_id, me)) || !COACH_DEPTS.includes(dept)) continue;
    seen.add(nid);
    rows.push({ coachId: c.member_id, name: c.name, dept, region: c.region || '' });
  }
  rows.sort((a, b) => (a.dept === b.dept ? (a.name < b.name ? -1 : 1) : (a.dept < b.dept ? -1 : 1)));
  return { rows };
}

export default {
  saveConnectCard, getConnectCard, searchConnectCards, deleteConnectCard,
  saveHelpPost, getHelpPosts, closeHelpPost, deleteHelpPost,
  recordMatch, setMatchDone, getConnectAdminOverview, getCoachList,
};
