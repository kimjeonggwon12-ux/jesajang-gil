// 필수교육 이수 현황
import { db, run } from '../lib/db.js';
import { normId, str, kstDate, kstDateTime, fmtTs, sameId } from '../lib/util.js';

const CATEGORIES = ['복음방교사양성교육', '섭외전도교육', '상담교육', '복음방교재교육', '교사소양교육'];

async function findRecord(memberId) {
  const rows = await run(db().from('required_education').select('*').eq('nid', normId(memberId)).order('id'));
  return rows.find((r) => sameId(r.member_id, memberId)) || null;
}

/** 화면이 받는 모양: { memberId, name, <항목>: 이수일…, 최종수정일, categories }. */
function toRecord(memberId, row) {
  const rec = { memberId: row ? row.member_id : memberId, name: row ? row.name : '' };
  for (const c of CATEGORIES) rec[c] = row?.completions[c] || '';
  rec['최종수정일'] = row ? row.updated_on : '';
  rec.categories = CATEGORIES;
  return rec;
}

async function getRequiredEducation(body) {
  const id = str(body.memberId);
  return toRecord(id, id ? await findRecord(id) : null);
}

/** 항목 하나의 이수일을 넣거나(clear 면) 지운다. 이력에도 남긴다. */
async function updateRequiredEducation(body) {
  const memberId = str(body.memberId);
  const category = str(body.category);
  if (!memberId) return { error: 'memberId가 필요합니다.' };
  if (!CATEGORIES.includes(category)) return { error: '알 수 없는 카테고리입니다: ' + category };
  const name = String(body.name || '');
  const today = kstDate();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(body.date)) ? str(body.date) : today;
  const value = body.clear ? '' : date;

  const row = await findRecord(memberId);
  const completions = { ...(row?.completions || {}) };
  if (value) completions[category] = value; else delete completions[category];
  if (row) {
    await run(db().from('required_education').update({ completions, updated_on: today, ...(name ? { name } : {}) }).eq('id', row.id));
  } else {
    await run(db().from('required_education').insert({ member_id: memberId, name, completions, updated_on: today }));
  }
  await run(db().from('required_education_log').insert({
    logged_at: kstDateTime(), member_id: memberId, name, category, completed_on: value,
    registrar: str(body.registrar), kind: body.clear ? '취소' : '등록',
  }));
  return toRecord(memberId, await findRecord(memberId));
}

/** 최근 등록·취소 이력 300건(최신이 위). */
async function getRequiredEducationLog() {
  const data = await run(db().from('required_education_log').select('*').order('id', { ascending: false }).limit(300));
  const rows = data.map((l) => ({
    at: fmtTs(l.logged_at).slice(0, 16), memberId: l.member_id, name: l.name, category: l.category,
    date: l.completed_on, registrar: l.registrar, kind: l.kind || '등록',
  }));
  return { rows };
}

export default { getRequiredEducation, updateRequiredEducation, getRequiredEducationLog };
