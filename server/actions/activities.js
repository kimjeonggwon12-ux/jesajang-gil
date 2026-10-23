// 활동 기록 · 격려 메시지 · 인도 실적
import { db, run, selectAll } from '../lib/db.js';
import { normId, str, kstDate, kstDateTime, fmtTs, byDesc } from '../lib/util.js';
import { notifyActivityChannel } from '../lib/telegram.js';
import { afterAction } from '../lib/events.js';
import { upsertTargetFromActivity, updateProfileFromEdit, TARGET_STAGES, cleanReport } from './targets.js';
import { findTeacher } from './roster.js';
import { roomForDept, postReport, reportRooms } from '../lib/report-room.js';

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

/** 앱이 보낸 기록 → activities 행의 칸들(새 기록·고친 기록이 같이 쓴다). 날짜를 지정하면 그 날짜 + timeOfDay('HH:MM:SS'). */
function activityFields(body, timeOfDay) {
  const recordedAt = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || '')) && !isNaN(new Date(body.date).getTime())
    ? `${body.date} ${timeOfDay}`
    : `${kstDate()} ${timeOfDay}`;
  const activities = body.activityItem
    ? [String(body.activityItem)]
    : (Array.isArray(body.activities) ? body.activities.map(String) : (body.activities ? String(body.activities).split(/,\s*/) : []));
  const t = body.target || {};
  const gender = oneOf(GENDER_OPTIONS, t.gender);
  const ageGroup = oneOf(AGE_GROUP_OPTIONS, t.ageGroup);
  return {
    submitted_at: recordedAt, activities, note: String(body.note || ''),
    roles: Array.isArray(body.roles) ? body.roles.filter((r) => ROLE_OPTIONS.includes(r)) : [],
    target_name: str(t.name), target_gender: gender, target_age_group: ageGroup, target_stage: oneOf(TARGET_STAGES, t.stage),
    special_note: String(t.note || ''), today_work: String(t.todayWork || ''), next_work: String(t.nextWork || ''),
    target_dept: ageGroup ? ageGenderToOrg(ageGroup, gender) : '',
    consult_title: String(body.consultTitle || ''), gospel_subject: String(body.gospelSubject || ''),
    reaction: oneOf(REACTION_OPTIONS, body.reaction), reaction_note: String(body.reactionNote || ''),
    report: cleanReport(body.report),   // 2026-10-23 보고방 문자 틀 칸
    report_text: String(body.reportText || '').slice(0, 6000),
  };
}

async function submitActivity(body) {
  const fields = activityFields(body, kstDateTime().slice(11));
  const memberId = String(body.memberId || '');
  const name = String(body.name || '');
  const { roles, activities, target_name: targetName, target_gender: gender, target_age_group: ageGroup, target_stage: stage, special_note: note, report } = fields;

  await run(db().from('activities').insert({ member_id: memberId, name, ...fields }));

  if (targetName) {
    await upsertTargetFromActivity({ memberId, name, roles, targetName, gender, ageGroup, stage, note, report, date: fields.submitted_at.slice(0, 10) });
  }

  const label = activities.join(', ');
  await notifyActivityChannel(`[활동등록] ${name || '이름미상'}님이 ${label}을(를) 등록했습니다${roles.length ? ` (${roles.join('/')})` : ''}`);

  return afterAction('submitActivity', body, { ok: true, submittedAt: fields.submitted_at });
}

/** 내 보고 기록 한 줄(남의 것이면 null). */
async function myActivity(memberId, id) {
  const rows = await run(db().from('activities').select('*').eq('id', Number(id) || 0).limit(1));
  return rows[0] && rows[0].nid === normId(memberId) ? rows[0] : null;
}
async function myRoom(memberId) {
  const teacher = await findTeacher(memberId);
  return roomForDept(teacher && teacher.dept);
}

/**
 * 2026-10-23 보고 기록 고치기 — 사용자: "보고 내용 기록을 케이스별로 수정할 수 있게, 수정해서 올리면 텔레봇에 수정한 것으로 다시 올라가게".
 * 같은 행을 고치고(시각은 그대로, 날짜만 바뀔 수 있음), 보고방에 이미 올린 기록이면 수정본을 처음 글에 답장으로 다시 올린다.
 * 섭외자 프로필은 보낸 칸만 덮고, 누적 교육 제목은 이 기록의 제목만 바꾼다. 단계 이력은 건드리지 않는다.
 */
async function updateActivity(body) {
  const mid = str(body.memberId);
  const old = mid && await myActivity(mid, body.id);
  if (!old) return { error: '고칠 기록을 찾을 수 없습니다.' };
  const fields = activityFields(body, fmtTs(old.submitted_at).slice(11) || '00:00:00');
  const editedAt = kstDateTime();
  await run(db().from('activities').update({ ...fields, edited_at: editedAt }).eq('id', old.id));
  if (fields.target_name && fields.report) {
    await updateProfileFromEdit(mid, fields.target_name, fields.report, fields.submitted_at.slice(0, 10), old.report && old.report.lesson);
  }
  let reposted = false, repostError = '';
  if ((old.tg_posts || []).length && fields.report_text) {
    try {
      const room = await myRoom(mid);
      if (room) { await postReport({ ...old, ...fields }, room, 'edit'); reposted = true; }
      else repostError = '부서 보고방 연결이 없어 수정본을 올리지 못했어요.';
    } catch (e) { repostError = e.message; }
  }
  return { ok: true, editedAt, reposted, repostError };
}

/** 보고 기록을 보고방에 처음 올린다. 이미 올린 기록은 고치면 수정본이 자동으로 올라간다. */
async function postActivityReport(body) {
  const mid = str(body.memberId);
  const row = mid && await myActivity(mid, body.id);
  if (!row) return { error: '올릴 기록을 찾을 수 없습니다.' };
  if (!row.report_text) return { error: '보고 문자가 없는 예전 기록이에요. 수정해서 저장하면 보고 문자가 생겨요.' };
  if ((row.tg_posts || []).some((p) => p.kind === 'post')) return { error: '이미 보고방에 올린 기록이에요. 고치면 수정본이 다시 올라가요.' };
  const room = await myRoom(mid);
  if (!room) return { error: '아직 내 부서 보고방이 연결되지 않았어요.' };
  const posts = await postReport(row, room, 'post');
  return { ok: true, tgPosts: posts, room: room.title };
}

const toActivityRow = (a) => ({
  id: a.id,
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
  report: a.report || null, reportTitle: (a.report && a.report.title) || '', reportText: a.report_text || '',
  editedAt: fmtTs(a.edited_at), tgPosts: a.tg_posts || [],
  aiFeedback: a.ai_feedback || '', aiFeedbackAt: fmtTs(a.ai_feedback_at),
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
  // 2026-10-23: 내 부서 보고방(없으면 기본 방) — 있으면 기록 카드에 [보고방에 올리기]
  const room = await myRoom(body.memberId).catch(() => null);
  return { rows, roleCounts, roleItemCounts, reportRoom: room ? { title: room.title || '보고방' } : null };
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
  submitActivity, updateActivity, postActivityReport, reportRooms, getMyActivities, getAllActivities,
  sendEncouragement, getMyEncouragements, markEncouragementRead,
  submitCenterLead, submitGospelLead, getMyGospelLeads,
};
