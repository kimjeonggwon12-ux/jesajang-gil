// AI 상담 · 피드백 이력 · 교관 요청/답변
import { db, run, selectAll } from '../lib/db.js';
import { normId, str, isoTs } from '../lib/util.js';
import { callAi, askAi, askAiModels, textOf } from '../lib/gemini.js';
import { findTeacher } from './roster.js';
import { addTargetAiNote, ownedTarget, targetDossier, TARGET_STAGES } from './targets.js';

const SOURCE = { ai: 'AI셀프코칭', escalation: '사람에스컬레이션', coach: '교관요청' };
const COACH_VISIBLE = [SOURCE.coach, SOURCE.escalation];

// ── AI ──

const generateContent = (body) => callAi(body.payload, body.model);

/** 전도 대상자 한 명에 대한 다음 단계 전략·대화 멘트.
 * 2026-10-20: 대상자(targetId)를 주면 답을 그 사람 기록(target_ai_notes)에 쌓아 개강 인도 계획 때 다시 읽힌다.
 * 하루 20회인 AI상담 모델 대신 개강 인도 계획과 같은 모델을 쓴다. */
// 2026-10-23(사용자): 기록 카드의 'AI 피드백'이 약하다 → 'AI 다음 단계 피드백'. 이 기록만이 아니라 그 섭외자의
//   모든 기록·단계 이력·교관 답·이전 AI 기록(targetDossier)을 같이 주고, 다음 단계·이번 주 할 일·멘트·조심할 점으로 답하게 한다.
async function getActivityFeedback(body) {
  const target = await ownedTarget(body.memberId, body.targetId);
  const stage = String(body.stage || (target && target.stage) || '미상');
  const i = TARGET_STAGES.indexOf(stage);
  const next = i >= 0 && i < TARGET_STAGES.length - 1 ? TARGET_STAGES[i + 1] : '';
  const d = target ? await targetDossier(target, str(body.memberId)) : null;
  const goal = target && target.goal_cohort ? `${Number(target.goal_cohort.slice(5))}월 개강 센터 인도` : '아직 정하지 않음';
  const prompt = [
    '당신은 교회 전도 교사를 돕는 베테랑 전도 코치입니다. 아래 섭외자를 지금 단계에서 바로 다음 단계로 올리기 위한 피드백을 주세요.',
    `- 섭외자: ${String(body.targetName || '대상자')} / 지금 단계: ${stage}${next ? ` / 다음 단계: ${next}` : ''} / 목표: ${goal}`,
    `- 이번 기록: 한 일 — ${String(body.todayWork || '기록 없음')} / 다음 할 일 — ${String(body.nextWork || '기록 없음')}`,
    d ? `\n[이 섭외자의 활동 기록 전부]\n${d.acts || '(없음)'}\n\n[단계 이력]\n${d.history || '(없음)'}\n\n[AI상담·교관 답]\n${d.coaching || '(없음)'}\n\n[이전 AI 기록]\n${d.notes || '(없음)'}` : '',
    '',
    '규칙: 기록에 나온 사실(반응·관심사·가족·일정)을 근거로 이 사람에게만 맞는 말로 쓰세요. 일반론·뻔한 말은 빼고 짧고 구체적으로.',
    '반드시 아래 4개 마크다운 제목을 정확히 그대로 쓰고 다른 제목은 추가하지 마세요:',
    `## 🎯 다음 단계${next ? `(${next})` : ''}로 가려면`, '## ✅ 이번 주 할 일 (3가지, 언제까지)', '## 💬 바로 쓸 대화 멘트', '## ⚠️ 조심할 점',
  ].join('\n');
  const text = await askAiModels(prompt, ['gemini-3.5-flash', 'gemini-3.8-flash']);
  if (target && !text.startsWith('⚠️')) {
    await addTargetAiNote(target.target_id, String(body.memberId), 'AI 다음 단계 피드백',
      `단계: ${String(body.stage || '')} / 한 일: ${String(body.todayWork || '')} / 다음: ${String(body.nextWork || '')}`, text);
  }
  return { text };
}

/** 부서별 교사 관리 화면의 "AI 분석". */
async function analyzeDistrictData(body) {
  const d = body.data || body;
  const prompt = `다음은 "${d.부서 || ''}" 부서 ${d.지역필터 || '전체'}` +
    ' 교사 활동 데이터입니다(이번 달, 역할기반 활동 기록 기준 — 역할은 인도자/교사/섬김이/협력교사, ' +
    '활동 항목은 피드백/섭외/친분/만남1/만남2/상담1/상담2/복음방/동행교사/센터소개/센터수강 11종, 협력교사만 전용 항목 동아리/잎사귀/만남 동행/밭보기/육상담/부스담당/은사/멘토교사/동행교사 9종).\n\n' +
    JSON.stringify(d) +
    '\n\n다음 항목을 분석해주세요:\n1. 전체적으로 어떤 활동에 집중되어 있는지\n' +
    '2. 특별히 강세를 보이는 지역과 그 이유 추정\n3. 취약한 지역과 보완이 필요한 활동 항목\n' +
    '4. 센터 인도(센터소개/센터수강 단계) 결과와 연관된 활동 패턴\n5. 다음 달 집중해야 할 활동 제안\n\n' +
    '한국어로 간결하고 실용적으로 답변하되, 반드시 아래 4개 마크다운 제목을 정확히 그대로 사용하고 ' +
    '다른 제목은 추가하지 마세요:\n## 📊 전체 활동 패턴\n## 🏆 강세 지역/항목\n## ⚠️ 보완 필요 지역/항목\n## 💡 다음 달 제안';
  return { text: await askAi(prompt) };
}

// ── 피드백 이력 ──

/** 새 접수번호 F-000123. DB 번호표에서 뽑으므로 동시에 접수해도 겹치지 않는다. */
const nextReceiptNo = () => run(db().rpc('next_receipt_no'));

async function addFeedback(fields) {
  const receiptNo = await nextReceiptNo();
  await run(db().from('feedbacks').insert({ receipt_no: receiptNo, submitted_at: new Date().toISOString(), ...fields }));
  return receiptNo;
}

/** AI 셀프 코칭: 답을 받아 이력에 남긴다. */
async function aiCoach(body) {
  const result = await callAi(body.payload, body.model);
  const coachText = textOf(result) ?? `(AI 응답 파싱 실패: ${JSON.stringify(result)})`;
  const receiptNo = await addFeedback({
    member_id: String(body.memberId ?? ''), name: String(body.name ?? ''), source: SOURCE.ai,
    situation: String(body.situation ?? ''), ai_coach_text: coachText, status: '완료',
  });
  return { receiptNo, coachText };
}

/** AI 답으로 부족할 때 사람(교관)에게 넘긴다. */
async function escalate(body) {
  const receiptNo = await addFeedback({
    member_id: String(body.memberId ?? ''), name: String(body.name ?? ''), source: SOURCE.escalation,
    situation: String(body.situation ?? ''), ai_coach_text: String(body.aiCoachText ?? ''), status: '접수',
  });
  return { receiptNo, status: 'ok' };
}

async function getHistory(body) {
  const mid = str(body.memberId);
  if (!mid) return { rows: [] };
  const data = await selectAll(() => db().from('feedbacks').select('*').eq('nid', normId(mid)).order('id'));
  const rows = data.map((f) => ({
    receiptNo: f.receipt_no, source: f.source, situation: f.situation, aiCoachText: f.ai_coach_text,
    handlerAnswer: f.handler_answer, status: f.status, submittedAt: isoTs(f.submitted_at),
  }));
  return { rows };
}

async function getAllFeedback() {
  const data = await selectAll(() => db().from('feedbacks').select('*').order('id'));
  const rows = data.map((f) => ({
    receiptNo: f.receipt_no, memberId: f.member_id, name: f.name, source: f.source, situation: f.situation,
    aiCoachText: f.ai_coach_text, handlerAnswer: f.handler_answer, status: f.status,
    submittedAt: isoTs(f.submitted_at), handler: f.handler, answeredAt: isoTs(f.answered_at),
  }));
  return { rows };
}

// ── 교관 ── 교관 = 관리자 명단에서 직책에 '교관'이 들어간 사람. 맡은 범위는 그 줄의 부서·지역(지역이 비면 부서 전체).

const coachRowsOf = async (memberId) =>
  run(db().from('admins').select('*').eq('nid', normId(memberId)).like('position', '%교관%').order('id'));

const toCoach = (a) => ({ region: a.region, coachId: a.member_id, coachName: a.name, dept: a.dept, status: '활성' });

/** 이 교관이 그 교사를 맡는가. */
const covers = (coachRows, teacher) =>
  !!teacher && coachRows.some((c) => c.dept === teacher.dept && (!c.region || c.region === teacher.region));

/** 내 담당 교관, 그리고 내가 교관인지. */
async function getMyCoach(body) {
  const mid = str(body.memberId);
  if (!mid) return { error: 'memberId 가 필요합니다.' };
  const [teacher, selfRows] = await Promise.all([findTeacher(mid), coachRowsOf(mid)]);
  const region = teacher?.region || '';
  let coach = null;
  if (teacher && region) {
    const candidates = await run(db().from('admins').select('*').eq('dept', teacher.dept).like('position', '%교관%').order('id'));
    const mine = candidates.find((c) => c.region === region) || candidates.find((c) => !c.region);
    coach = mine ? toCoach(mine) : null;
  }
  return {
    region, coach, isCoach: selfRows.length > 0,
    myCoachInfo: selfRows.length ? {
      coachId: selfRows[0].member_id, coachName: selfRows[0].name,
      regions: selfRows.map((c) => c.region), depts: selfRows.map((c) => c.dept),
    } : null,
  };
}

async function requestCoach(body) {
  const mid = str(body.memberId);
  const content = str(body.content);
  if (!mid || !content) return { error: 'memberId, content 가 필요합니다.' };
  const receiptNo = await addFeedback({ member_id: mid, name: String(body.name || ''), source: SOURCE.coach, situation: content, status: '접수' });
  return { receiptNo, status: 'ok' };
}

async function getMyCoachRequests(body) {
  const mid = str(body.memberId);
  if (!mid) return { error: 'memberId 가 필요합니다.' };
  const data = await run(db().from('feedbacks').select('*').eq('nid', normId(mid)).eq('source', SOURCE.coach).order('id'));
  const rows = data.map((f) => ({
    receiptNo: f.receipt_no, situation: f.situation, handlerAnswer: f.handler_answer,
    status: f.status, submittedAt: isoTs(f.submitted_at), answeredAt: isoTs(f.answered_at),
  }));
  return { rows };
}

/** 요청을 낸 교사들의 명단 정보. */
async function teachersOf(feedbacks) {
  const nids = [...new Set(feedbacks.map((f) => f.nid))];
  if (!nids.length) return new Map();
  const teachers = await run(db().from('teachers').select('nid, name, region, dept, tier').in('nid', nids));
  return new Map(teachers.map((t) => [t.nid, t]));
}

/** 교관 화면: 내가 맡은 교사들의 요청(대기 / 답변 완료). */
async function getCoachFeedbacks(body) {
  const coachId = str(body.coachId);
  if (!coachId) return { error: 'coachId 가 필요합니다.' };
  const coachRows = await coachRowsOf(coachId);
  if (!coachRows.length) return { error: '활성 교관으로 등록되어 있지 않습니다.' };

  const requests = await selectAll(() => db().from('feedbacks').select('*').eq('source', SOURCE.coach).order('id'));
  const teacherOf = await teachersOf(requests);
  const pending = [], answered = [];
  for (const f of requests) {
    const t = teacherOf.get(f.nid);
    if (!covers(coachRows, t)) continue;
    const item = {
      receiptNo: f.receipt_no, memberId: f.member_id, name: t.name || f.name, region: t.region, tier: t.tier || '',
      situation: f.situation, handlerAnswer: f.handler_answer, status: f.status,
      submittedAt: isoTs(f.submitted_at), answeredAt: isoTs(f.answered_at),
    };
    (f.status === '완료' ? answered : pending).push(item);
  }
  return { regions: [...new Set(coachRows.map((c) => c.region))], pending, answered };
}

async function submitCoachReply(body) {
  const feedbackId = str(body.feedbackId);
  const reply = str(body.reply);
  const coachId = str(body.coachId);
  if (!feedbackId || !reply || !coachId) return { error: 'feedbackId, reply, coachId 가 필요합니다.' };
  const coachRows = await coachRowsOf(coachId);
  if (!coachRows.length) return { error: '활성 교관으로 등록되어 있지 않습니다.' };

  const [f] = await run(db().from('feedbacks').select('*').eq('receipt_no', feedbackId).order('id').limit(1));
  if (!f) return { error: '해당 요청을 찾을 수 없습니다.' };
  if (!COACH_VISIBLE.includes(f.source)) return { error: '답변 가능한 요청 유형이 아닙니다.' };
  if (!covers(coachRows, await findTeacher(f.member_id))) return { error: '담당 지역의 요청이 아닙니다.' };

  await run(db().from('feedbacks').update({
    handler_answer: reply, status: '완료', handler: coachRows[0].name || coachId, answered_at: new Date().toISOString(),
  }).eq('id', f.id));
  return { ok: true };
}

export default {
  generateContent, getActivityFeedback, analyzeDistrictData, aiCoach, escalate, getHistory, getAllFeedback,
  getMyCoach, requestCoach, getMyCoachRequests, getCoachFeedbacks, submitCoachReply,
};
