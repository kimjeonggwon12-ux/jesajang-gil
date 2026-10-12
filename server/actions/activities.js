// 활동 기록 · 격려 메시지 · 인도 실적
import { db, run, selectAll } from '../lib/db.js';
import { normId, str, kstDate, kstDateTime, fmtTs, byDesc } from '../lib/util.js';
import { notifyActivityChannel } from '../lib/telegram.js';
import { afterAction } from '../lib/events.js';
import { upsertTargetFromActivity, TARGET_STAGES } from './targets.js';

// ⚠️ app.html 의 같은 이름 상수와 같이 맞출 것.
export const ROLE_OPTIONS = ['인도자', '교사', '섬김이', '협력교사'];
const GENDER_OPTIONS = ['남', '여'];
const AGE_GROUP_OPTIONS = ['10대', '20대', '30대', '40대', '50대', '60대', '70대이상'];
const REACTION_OPTIONS = ['긍정적', '중립', '부정적'];

const oneOf = (options, v) => (options.includes(v) ? v : '');

/** 대상자 연령대×성별 → 부서. app.html 의 ageGenderToOrg() 와 같은 규칙. */
function ageGenderToOrg(ageGroup, gender) {
  if (ageGroup === '70대이상') return '자문';
  if (['40대', '50대', '60대'].includes(ageGroup)) return gender === '여' ? '부녀' : '장년';
  if (['10대', '20대', '30대'].includes(ageGroup)) return '청년';
  return '';
}

export const emptyRoleCounts = () => Object.fromEntries(ROLE_OPTIONS.map((r) => [r, 0]));

async function submitActivity(body) {
  const now = kstDateTime();
  // 날짜를 지정하면 그 날짜 + 지금 시각으로 기록한다.
  const recordedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) && !isNaN(new Date(body.date).getTime())
    ? `${body.date} ${now.slice(11)}`
    : now;
  const activities = body.activityItem
    ? [String(body.activityItem)]
    : (Array.isArray(body.activities) ? body.activities.map(String) : (body.activities ? String(body.activities).split(/,\s*/) : []));
  const roles = Array.isArray(body.roles) ? body.roles.filter((r) => ROLE_OPTIONS.includes(r)) : [];
  const t = body.target || {};
  const targetName = str(t.name);
  const gender = oneOf(GENDER_OPTIONS, t.gender);
  const ageGroup = oneOf(AGE_GROUP_OPTIONS, t.ageGroup);
  const stage = oneOf(TARGET_STAGES, t.stage);
  const note = String(t.note || '');
  const memberId = String(body.memberId || '');
  const name = String(body.name || '');

  await run(db().from('activities').insert({
    member_id: memberId, name, submitted_at: recordedAt, activities, note: String(body.note || ''), roles,
    target_name: targetName, target_gender: gender, target_age_group: ageGroup, target_stage: stage,
    special_note: note, today_work: String(t.todayWork || ''), next_work: String(t.nextWork || ''),
    target_dept: ageGroup ? ageGenderToOrg(ageGroup, gender) : '',
    consult_title: String(body.consultTitle || ''), gospel_subject: String(body.gospelSubject || ''),
    reaction: oneOf(REACTION_OPTIONS, body.reaction), reaction_note: String(body.reactionNote || ''),
  }));

  if (targetName) {
    await upsertTargetFromActivity({ memberId, name, roles, targetName, gender, ageGroup, stage, note });
  }

  const label = activities.join(', ');
  await notifyActivityChannel(`[활동등록] ${name || '이름미상'}님이 ${label}을(를) 등록했습니다${roles.length ? ` (${roles.join('/')})` : ''}`);

  return afterAction('submitActivity', body, { ok: true, submittedAt: recordedAt });
}

const toActivityRow = (a) => ({
  memberId: a.member_id,
  name: a.name,
  submittedAt: fmtTs(a.submitted_at),
  activities: a.activities,
  note: a.note,
  roles: a.roles,
  targetName: a.target_name, targetGender: a.target_gender, targetAgeGroup: a.target_age_group,
  targetStage: a.target_stage, specialNote: a.special_note, todayWork: a.today_work, nextWork: a.next_work,
  targetDept: a.target_dept,
  consultTitle: a.consult_title, gospelSubject: a.gospel_subject, reaction: a.reaction, reactionNote: a.reaction_note,
});

/** 내 활동 기록 + 올해 역할별·항목별 건수. */
async function getMyActivities(body) {
  const data = await selectAll(() => db().from('activities').select('*').eq('nid', normId(body.memberId)).order('id'));
  const rows = data.map(toActivityRow).sort(byDesc('submittedAt'));

  const year = kstDate().slice(0, 4);
  const roleCounts = emptyRoleCounts();
  const roleItemCounts = Object.fromEntries(ROLE_OPTIONS.map((r) => [r, {}]));
  for (const row of rows) {
    if (row.submittedAt.slice(0, 4) !== year) continue;
    for (const role of row.roles) {
      if (roleCounts[role] === undefined) continue;
      roleCounts[role]++;
      for (const item of row.activities) {
        if (item) roleItemCounts[role][item] = (roleItemCounts[role][item] || 0) + 1;
      }
    }
  }
  return { rows, roleCounts, roleItemCounts };
}

async function getAllActivities() {
  const data = await selectAll(() => db().from('activities')
    .select('member_id, name, submitted_at, activities, note, roles, target_name, target_stage')
    .neq('member_id', '').order('id'));
  const rows = data.map((a) => ({
    memberId: a.member_id, name: a.name, submittedAt: fmtTs(a.submitted_at), activities: a.activities,
    note: a.note, roles: a.roles, targetName: a.target_name, targetStage: a.target_stage,
  })).sort(byDesc('submittedAt'));
  return { rows };
}

// ── 격려 메시지 ── 메시지 식별은 "받는 사람 번호::보낸 시각".

async function sendEncouragement(body) {
  const toId = str(body.toId);
  const message = str(body.message);
  if (!toId || !message) return { error: 'toId, message 가 필요합니다.' };
  const now = kstDateTime();
  await run(db().from('encouragements').insert({
    from_id: String(body.fromId || ''), from_name: String(body.fromName || ''), to_id: toId, message, sent_at: now,
  }));
  return { ok: true, sentAt: now };
}

async function getMyEncouragements(body) {
  const nid = normId(body.memberId);
  const data = await run(db().from('encouragements').select('*').eq('to_nid', nid).eq('is_read', false).order('id'));
  const rows = data.map((e) => {
    const sentAt = fmtTs(e.sent_at);
    return { id: `${nid}::${sentAt}`, fromName: e.from_name, message: e.message, sentAt };
  }).sort(byDesc('sentAt'));
  return { rows };
}

async function markEncouragementRead(body) {
  const messageId = String(body.messageId || '');
  const sep = messageId.indexOf('::');
  if (sep === -1) return { error: 'messageId 형식이 올바르지 않습니다.' };
  const nid = messageId.slice(0, sep);
  const sentAt = messageId.slice(sep + 2);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sentAt)) return { error: '메시지를 찾을 수 없습니다.' };
  const found = await run(db().from('encouragements').select('id').eq('to_nid', nid).eq('sent_at', sentAt).order('id').limit(1));
  if (!found.length) return { error: '메시지를 찾을 수 없습니다.' };
  await run(db().from('encouragements').update({ is_read: true }).eq('id', found[0].id));
  return { ok: true };
}

// ── 인도 실적 ──

async function addLead(table, body) {
  const today = kstDate();
  const name = String(body.name || '');
  await run(db().from(table).insert({
    member_id: String(body.memberId || ''), name, lead_date: today,
    lead_name: String(body.leadName || ''), registered_by: name,
  }));
  return { ok: true, date: today };
}

const submitCenterLead = async (body) => afterAction('submitCenterLead', body, await addLead('center_leads', body));
const submitGospelLead = (body) => addLead('gospel_leads', body);

async function getMyGospelLeads(body) {
  const mid = str(body.memberId);
  if (!mid) return { error: 'memberId 가 필요합니다.' };
  const data = await run(db().from('gospel_leads').select('*').eq('nid', normId(mid)).order('id'));
  const rows = data.map((l) => ({ date: l.lead_date || '', leadName: l.lead_name, registeredBy: l.registered_by }))
    .sort(byDesc('date'));
  return { rows };
}

export default {
  submitActivity, getMyActivities, getAllActivities,
  sendEncouragement, getMyEncouragements, markEncouragementRead,
  submitCenterLead, submitGospelLead, getMyGospelLeads,
};
