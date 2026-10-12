// 전도 대상자 — 활동 등록의 부산물로 자동 생성·갱신되고, 단계가 바뀔 때마다 이력이 남는다.
import { randomUUID } from 'node:crypto';
import { db, run, selectAll } from '../lib/db.js';
import { normId, str, kstDate, kstDateTime, fmtTs } from '../lib/util.js';
import { notifyActivityChannel } from '../lib/telegram.js';
import { onStageReached } from '../lib/events.js';
import { findTeacher, findCoaches } from './roster.js';

export const TARGET_STAGES = ['섭외', '친분', '만남1', '만남2', '상담1', '상담2', '복음방', '센터소개', '센터수강'];

/** 내가 담당(최초 등록·인도자·섬김이 중 하나)인 대상자만 고르는 조건. */
const ownedBy = (nid) => `creator_nid.eq.${nid},leader_nid.eq.${nid},helper_nid.eq.${nid}`;
const owns = (t, nid) => t.creator_nid === nid || t.leader_nid === nid || t.helper_nid === nid;

async function findTarget(targetId) {
  const rows = await run(db().from('targets').select('*').eq('target_id', targetId).limit(1));
  return rows[0] || null;
}

async function appendHistory(memberId, targetId, fromStage, toStage, memo) {
  await run(db().from('target_history').insert({
    member_id: memberId, target_id: targetId, changed_at: kstDateTime(),
    from_stage: fromStage || '', to_stage: toStage || '', memo: memo || '',
  }));
  await onStageReached(memberId, targetId, fromStage, toStage);
}

/** 복음방 단계에 도달하면 담당 교관에게 알린다. */
async function notifyGospelRoom(memberId, teacherName, targetName) {
  try {
    const teacher = await findTeacher(memberId);
    const region = teacher?.region || '';
    const coaches = teacher ? await findCoaches(teacher.dept, region) : [];
    const names = coaches.map((c) => c.name).join(', ') || '(담당 교관 미등록)';
    await notifyActivityChannel(`🌱 [복음방 도달] ${region} 지역 담당 교관님(${names}) — ` +
      `${teacherName || memberId}교사님의 전도 대상자 ${targetName}님이 복음방 단계에 도달했습니다.`);
  } catch { /* 알림 실패는 무시 */ }
}

/** 활동에 적힌 역할대로 담당 인도자·섬김이를 이 교사로 배정한다(바뀌면 변경 이력에 한 줄). */
function roleAssignment(target, roles, memberId) {
  const patch = {};
  const log = [];
  const today = kstDate();
  const assign = (role, column, label) => {
    if (!roles.includes(role)) return;
    const old = str(target[column]);
    if (normId(old) === normId(memberId)) return;
    patch[column] = memberId;
    if (old) log.push(`${today} ${label} 변경: ${old} → ${memberId}`);
  };
  assign('인도자', 'leader_id', '담당인도자');
  assign('섬김이', 'helper_id', '담당섬김이');
  if (log.length) patch.teacher_change_log = [target.teacher_change_log, ...log].filter(Boolean).join('; ');
  return patch;
}

/** 활동 등록 때: 같은 이름의 내 담당 대상자가 있으면 갱신, 없으면 새로 만든다. */
export async function upsertTargetFromActivity({ memberId, name, roles, targetName, gender, ageGroup, stage, note }) {
  const mid = str(memberId);
  if (!mid || !targetName) return;
  const now = kstDateTime();
  const mine = await run(db().from('targets').select('*').or(ownedBy(normId(mid))).order('id'));
  const existing = mine.find((t) => t.target_name.trim() === targetName);

  if (existing) {
    const patch = { ...roleAssignment(existing, roles, mid), updated_at: now };
    const stageChanged = stage && stage !== existing.stage;
    if (stageChanged) patch.stage = stage;
    if (gender) patch.gender = gender;
    if (ageGroup) patch.age_group = ageGroup;
    await run(db().from('targets').update(patch).eq('id', existing.id));
    if (stageChanged) {
      await appendHistory(mid, existing.target_id, existing.stage, stage, note);
      if (stage === '복음방') await notifyGospelRoom(mid, name, targetName);
    }
    return;
  }

  const firstStage = stage || TARGET_STAGES[0];
  const fresh = {
    target_id: randomUUID(), creator_id: mid, teacher_name: String(name || ''), target_name: targetName,
    stage: firstStage, memo: note || '', created_at: now, updated_at: now, gender: gender || '', age_group: ageGroup || '',
    leader_id: '', helper_id: '', teacher_change_log: '',
  };
  await run(db().from('targets').insert({ ...fresh, ...roleAssignment(fresh, roles, mid) }));
  await appendHistory(mid, fresh.target_id, '', firstStage, '활동 등록으로 자동 생성');
  if (stage === '복음방') await notifyGospelRoom(mid, name, targetName);
}

async function addTarget(body) {
  const mid = str(body.memberId);
  const targetName = str(body.targetName);
  if (!mid || !targetName) return { error: 'memberId, targetName 이 필요합니다.' };
  const stage = TARGET_STAGES.includes(str(body.stage)) ? str(body.stage) : TARGET_STAGES[0];
  const targetId = randomUUID();
  const now = kstDateTime();
  const name = String(body.name || '');
  await run(db().from('targets').insert({
    target_id: targetId, creator_id: mid, teacher_name: name, target_name: targetName, stage,
    next_meeting_date: String(body.nextMeetingDate || ''), memo: String(body.memo || ''), created_at: now, updated_at: now,
  }));
  await appendHistory(mid, targetId, '', stage, '대상자 등록');
  if (stage === '복음방') await notifyGospelRoom(mid, name, targetName);
  return { ok: true, targetId };
}

const toTarget = (t) => ({
  targetId: t.target_id, targetName: t.target_name, stage: t.stage,
  nextMeetingDate: t.next_meeting_date, memo: t.memo,
  createdAt: fmtTs(t.created_at), updatedAt: fmtTs(t.updated_at),
  completed: t.completed, gender: t.gender, ageGroup: t.age_group,
  leaderId: t.leader_id, helperId: t.helper_id, teacherChangeLog: t.teacher_change_log,
});

const toHistory = (h) => ({ changedAt: fmtTs(h.changed_at), fromStage: h.from_stage, toStage: h.to_stage, memo: h.memo });
const newestFirst = (a, b) => (a.changedAt < b.changedAt ? 1 : -1);

/** 내 담당 대상자 목록(다음 만남이 가까운 순, 날짜 없는 것은 뒤) + 내가 남긴 단계 이력. */
async function getTargets(body) {
  const mid = str(body.memberId);
  if (!mid) return { error: 'memberId 가 필요합니다.' };
  const nid = normId(mid);
  const targets = await selectAll(() => db().from('targets').select('*').or(ownedBy(nid)).order('id'));
  const rows = targets.map((t) => ({ ...toTarget(t), history: [] }));
  const byId = new Map(rows.map((t) => [t.targetId, t]));

  const history = await selectAll(() => db().from('target_history').select('*').eq('nid', nid).order('id'));
  for (const h of history) byId.get(h.target_id.trim())?.history.push(toHistory(h));
  for (const t of rows) t.history.sort(newestFirst);

  rows.sort((a, b) => {
    if (!a.nextMeetingDate && !b.nextMeetingDate) return 0;
    if (!a.nextMeetingDate) return 1;
    if (!b.nextMeetingDate) return -1;
    return a.nextMeetingDate < b.nextMeetingDate ? -1 : 1;
  });
  return { rows, stages: TARGET_STAGES };
}

async function updateTarget(body) {
  const mid = str(body.memberId);
  const targetId = str(body.targetId);
  if (!mid || !targetId) return { error: 'memberId, targetId 가 필요합니다.' };
  const target = await findTarget(targetId);
  if (!target) return { error: '해당 대상자를 찾을 수 없습니다.' };
  if (!owns(target, normId(mid))) return { error: '본인 소유의 전도 대상자가 아닙니다.' };

  const patch = { updated_at: kstDateTime() };
  const newStage = body.stage !== undefined && TARGET_STAGES.includes(String(body.stage)) && String(body.stage) !== target.stage
    ? String(body.stage) : null;
  if (newStage) patch.stage = newStage;
  if (body.nextMeetingDate !== undefined) patch.next_meeting_date = String(body.nextMeetingDate);
  if (body.memo !== undefined) patch.memo = String(body.memo);
  if (body.completed !== undefined) patch.completed = !!body.completed;
  await run(db().from('targets').update(patch).eq('id', target.id));

  if (newStage) {
    await appendHistory(mid, targetId, target.stage, newStage, String(body.memo || ''));
    if (newStage === '복음방') await notifyGospelRoom(mid, target.teacher_name, target.target_name);
  }
  return { ok: true };
}

/** 대상자와 이름이 같고, 담당자(등록·인도·섬김) 중 한 명이 쓴 활동 기록. */
async function activitiesAbout(target) {
  const owners = new Set([target.creator_id, target.leader_id, target.helper_id].filter((id) => str(id)).map(normId));
  if (!target.target_name.trim() || !owners.size) return [];
  const rows = await selectAll(() => db().from('activities').select('*').in('nid', [...owners]).order('id'));
  return rows.filter((a) => a.target_name.trim() === target.target_name.trim());
}

/** 대상자 한 명의 누적 일지: 단계 이력 + 담당자들이 남긴 활동 기록. */
async function getTargetJournal(body) {
  const mid = str(body.memberId);
  const targetId = str(body.targetId);
  if (!mid || !targetId) return { error: 'memberId, targetId 가 필요합니다.' };
  const row = await findTarget(targetId);
  if (!row) return { error: '해당 대상자를 찾을 수 없습니다.' };
  if (!owns(row, normId(mid))) return { error: '본인 담당의 전도 대상자가 아닙니다.' };

  const [history, activities] = await Promise.all([
    run(db().from('target_history').select('*').eq('target_id', targetId).order('id')),
    activitiesAbout(row),
  ]);
  const journal = activities.map((a) => ({
    submittedAt: fmtTs(a.submitted_at), writerName: a.name, writerId: a.member_id,
    roles: a.roles, activityItem: a.activities.join(', '),
    stage: a.target_stage, note: a.special_note, todayWork: a.today_work, nextWork: a.next_work,
  })).sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

  return {
    target: { ...toTarget(row), targetId, creatorId: row.creator_id },
    stageHistory: history.map(toHistory).sort(newestFirst),
    journal,
    stages: TARGET_STAGES,
  };
}

/** 대상자를 영구 삭제한다 — 단계 이력과 그 대상자에 대한 담당자들의 활동 기록까지. */
async function deleteTarget(body) {
  const mid = str(body.memberId);
  const targetId = str(body.targetId);
  if (!mid || !targetId) return { error: 'memberId, targetId 가 필요합니다.' };
  const target = await findTarget(targetId);
  if (!target) return { error: '해당 대상자를 찾을 수 없습니다.' };
  if (!owns(target, normId(mid))) return { error: '본인 담당의 전도 대상자만 삭제할 수 있습니다.' };

  const activityIds = (await activitiesAbout(target)).map((a) => a.id);
  if (activityIds.length) await run(db().from('activities').delete().in('id', activityIds));
  const history = await run(db().from('target_history').delete().eq('target_id', targetId).select('id'));
  await run(db().from('targets').delete().eq('id', target.id));
  return { ok: true, targetName: target.target_name.trim(), deletedActivities: activityIds.length, deletedHistory: history.length };
}

export default {
  addTarget, getTargets, getMyTargets: getTargets, updateTarget, updateTargetStage: updateTarget,
  getTargetJournal, deleteTarget,
};
