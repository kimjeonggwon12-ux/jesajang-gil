// 교육 과정 자동 서머리(5분마다 attAutoSummary 가 부른다): 정해진 시각이 지나면 과정 텔레그램 방으로 결과를 보낸다.
//   출석 — 그날 출석 모임이 끝나고 10분 뒤: 출석 n/전체, 지각, 결석 명단
//   과제 — 그날 낼 과제의 마감 시각(비면 23:55)이 지나면: 제출 n/전체, 늦게 낸 사람, 미제출 명단
//   시험 — 그날 시험의 점수 마감 시각(비면 23:55)이 지나면: 점수 n/전체, 평균·최고, 점수 목록, 미입력 명단
// 같은 서머리는 cohort_summary_log 로 한 번만 보낸다.
import { db, run } from '../lib/db.js';
import { runReportBatch } from '../lib/report-delivery-batch.js';
import { reportInstant } from '../lib/report-schedule.js';
import { normId, kstDate, kstDateTime } from '../lib/util.js';
import { sendAttendText } from '../lib/attend-bot.js';
import { toCohort, weekdayOf, isClassDay, assignmentOn } from '../lib/cohort.js';
import { toAssignment, toExam, examOn, cohortAbsenceLines, sendBoards } from './cohorts.js';

/** 출석 마감 요약 끝에 붙이는 결석 누적·빠진 교육(일정표 기준) */
async function absenceBlock(c) {
  try {
    const lines = await cohortAbsenceLines(c);
    return lines.length ? ['', '🚫 결석 누적 · 빠진 교육', ...lines] : [];
  } catch (e) { return []; }
}
import { loadRecords } from './attendance.js';

const mmdd = (d) => String(d).slice(5).replace('-', '/');
const key = (s) => String(s || '').replace(/\s/g, '');
const names = (list) => list.map((m) => m.name + (m.church ? `(${m.church})` : '')).join(', ');

/** only: 이 과정만(점검 도구가 실제 과정을 건드리지 않게). 한 과정에서 오류가 나도 다른 과정은 계속. */
export async function cohortTick(only = '', failures = []) {
  const today = kstDate();
  const hm = kstDateTime().slice(11, 16);
  const now = Date.now();
  const yesterday = kstDate(new Date(now - 864e5));
  const sent = [];
  const cohorts = (await run(db().from('cohorts').select('*').eq('status', '진행'))).map(toCohort).filter((x) => !only || x.cohortId === only);
  for (const c of cohorts) {
    try { await tickOne(c, today, yesterday, now, hm, sent, failures); } catch (e) { failures.push({scope:'cohort',ref:c.cohortId,state:'review'}); }
  }
  return sent;
}

async function tickOne(c, today, yesterday, now, hm, sent, failures) {
  {
    if (!c.tgChat) return;   // 방이 연결된 과정만
    // 5분마다 도는 일이라, 먼저 "지금 보낼 서머리가 있나"만 가볍게 본다 — 없으면 교육생 명단 등은 받지 않는다
    const [mts, asgs, exs, done] = await Promise.all([
      c.useAttend ? run(db().from('attend_meetings').select('meeting_id, date, end_time, status').eq('cohort_id', c.cohortId).gte('date', yesterday).lte('date', today).neq('status', '삭제')) : [],
      c.useAssign ? run(db().from('cohort_assignments').select('assignment_id, repeat, days, dates, due, due_time').eq('cohort_id', c.cohortId).eq('status', '열림')) : [],
      run(db().from('cohort_exams').select('exam_id, days, dates, date, due_time, status').eq('cohort_id', c.cohortId).eq('status', '열림')),
      run(db().from('cohort_summary_log').select('kind, ref_id, date').eq('cohort_id', c.cohortId).gte('date', yesterday).lte('date', today)),
    ]);
    const sentAlready = new Set(done.map((x) => x.kind + '|' + x.ref_id + '|' + x.date));
    for(const m of mts)if(m.status!=='집계완료'&&sentAlready.has('출석|'+m.meeting_id+'|'+m.date))await run(db().from('attend_meetings').update({status:'집계완료',updated_at:kstDateTime()}).eq('meeting_id',m.meeting_id).neq('status','삭제'));
    // 전날은 +10분 예정 시각이 오늘로 넘어온 모임만 이어 받는다. 과거 보고 일괄 소급 금지.
    const attendanceDue = m => { const at = reportInstant(m.date, m.end_time, 10); return now >= at && (m.date === today || at >= reportInstant(today, '00:00')); };
    const inPeriod = isClassDay({ ...c, days: '' }, today);
    const due = mts.some((m) => attendanceDue(m) && !sentAlready.has('출석|' + m.meeting_id + '|' + m.date))
      || (inPeriod && asgs.map(toAssignment).some((a) => (a.repeat !== '한번' ? assignmentOn(a, today) : a.due === today) && hm >= (a.dueTime || '23:55') && !sentAlready.has('과제|' + a.assignmentId + '|' + today)))
      || (inPeriod && exs.map(toExam).some((e) => examOn(e, today) && hm >= (e.dueTime || '23:55') && !sentAlready.has('시험|' + e.examId + '|' + today)));
    if (!due) return;
    const members = await run(db().from('cohort_members').select('seq, member_id, nid, name, church').eq('cohort_id', c.cohortId).order('seq').order('id'));
    if (!members.length) return;
    const total = members.length;
    const context = (kind, ref, date = today) => ({namespace:c.cohortId,kind,ref,date,room:{dept:c.cohortId,chat_id:c.tgChat}});
    const day = `${mmdd(today)}(${weekdayOf(today)})`;   // 보고 맨 위: 교육 이름 + 무엇에 대한 보고

    // ── 출석 ──
    if (c.useAttend) {
      const meetings = await run(db().from('attend_meetings').select('*').eq('cohort_id', c.cohortId).gte('date', yesterday).lte('date', today).neq('status', '삭제'));
      for (const m of meetings) {
        if (!attendanceDue(m)) continue;
        const attendanceDay = `${mmdd(m.date)}(${weekdayOf(m.date)})`;
        const result = await runReportBatch(context('출석',m.meeting_id,m.date), async()=>{
        const recs = await loadRecords((q) => q.eq('meeting_id', m.meeting_id));
        const byNid = new Map(recs.map((r) => [normId(r.memberId), r]));
        const came = members.filter((x) => byNid.has(x.nid));
        const late = came.filter((x) => /지각/.test(byNid.get(x.nid).late || ''));
        const part = came.filter((x) => /결석|조퇴|외출/.test(byNid.get(x.nid).late || ''));
        const absent = members.filter((x) => !byNid.has(x.nid));
        await sendAttendText([
          `📋 ${c.title} 출석부 · ${attendanceDay} 출석 마감 (${String(m.start_time).slice(0, 5)}~${String(m.end_time).slice(0, 5)})`,
          `✅ 출석 ${came.length}/${total}명 (${Math.round((came.length / total) * 100)}%)`,
          late.length ? `⏰ 지각 ${late.length}명: ${late.map((x) => `${x.name} ${byNid.get(x.nid).late}`).join(', ')}` : '',
          part.length ? `◐ 부분 결석 ${part.length}명: ${part.map((x) => `${x.name} ${byNid.get(x.nid).late}`).join(', ')}` : '',
          absent.length ? `❌ 결석 ${absent.length}명: ${names(absent)}` : '🎉 전원 출석!',
        ].filter(Boolean).concat(await absenceBlock(c)).join('\n'), c.tgChat, {strict:true});
        await sendBoards(c, { kind: 'attend', strict:true });
        }, failures);
        if (result.ok) await run(db().from('attend_meetings').update({status:'집계완료',updated_at:kstDateTime()}).eq('meeting_id',m.meeting_id).neq('status','삭제'));
        if (result.state==='delivered') sent.push(`${c.title} 출석`);
      }
    }

    // ── 과제 ──
    if (c.useAssign && isClassDay({ ...c, days: '' }, today)) {
      const asg = (await run(db().from('cohort_assignments').select('*').eq('cohort_id', c.cohortId).eq('status', '열림'))).map(toAssignment);
      for (const a of asg) {
        const repeat = a.repeat !== '한번';
        if (repeat ? !assignmentOn(a, today) : a.due !== today) continue;
        if (hm < (a.dueTime || '23:55')) continue;
        const result = await runReportBatch(context('과제',a.assignmentId), async()=>{
        const subs = await run(db().from('cohort_submissions').select('nid, late').eq('assignment_id', a.assignmentId).eq('work_date', repeat ? today : ''));
        const done = new Map(subs.map((s) => [s.nid, s]));
        const ok = members.filter((x) => done.has(x.nid));
        const late = ok.filter((x) => done.get(x.nid).late);
        const missing = members.filter((x) => !done.has(x.nid));
        await sendAttendText([
          `📝 ${c.title} 과제 제출 현황 · ${day} 마감 — ${a.title} (${a.dueTime || '자정'})`,
          `✅ 제출 ${ok.length}/${total}명 (${Math.round((ok.length / total) * 100)}%)`,
          late.length ? `⏰ 늦게 냄 ${late.length}명: ${names(late)}` : '',
          missing.length ? `❌ 미제출 ${missing.length}명: ${names(missing)}` : '🎉 전원 제출!',
        ].filter(Boolean).join('\n'), c.tgChat, {strict:true});
        }, failures);
        if (result.state==='delivered') sent.push(`${c.title} 과제 ${a.title}`);
      }
    }

    // ── 시험 ──
    const exams = (await run(db().from('cohort_exams').select('*').eq('cohort_id', c.cohortId).eq('status', '열림'))).map(toExam);
    for (const e of exams) {
      if (!examOn(e, today) || !isClassDay({ ...c, days: '' }, today)) continue;
      if (hm < (e.dueTime || '23:55')) continue;
      const result = await runReportBatch(context('시험',e.examId), async()=>{
      const scores = (await run(db().from('cohort_scores').select('nid, name, score, subject').eq('cohort_id', c.cohortId).eq('date', today)))
        .filter((s) => key(s.subject) === key(e.subject));
      const byNid = new Map(scores.map((s) => [s.nid, Number(s.score)]));
      const got = members.filter((x) => byNid.has(x.nid)).sort((x, y) => byNid.get(y.nid) - byNid.get(x.nid));
      const missing = members.filter((x) => !byNid.has(x.nid));
      const vals = got.map((x) => byNid.get(x.nid));
      const avg = vals.length ? Math.round((vals.reduce((p, q) => p + q, 0) / vals.length) * 10) / 10 : 0;
      await sendAttendText([
        `🧪 ${c.title} 시험 결과 및 순위 · ${day} — ${e.subject}`,
        `✅ 점수 ${got.length}/${total}명${vals.length ? ` · 평균 ${avg} · 최고 ${Math.max(...vals)} · 최저 ${Math.min(...vals)}` : ''}`,
        got.length ? got.map((x, i) => `${i + 1}. ${x.name} ${byNid.get(x.nid)}`).join('\n') : '',
        missing.length ? `❌ 점수 없음 ${missing.length}명: ${names(missing)}` : '',
      ].filter(Boolean).join('\n'), c.tgChat, {strict:true});
      await sendBoards(c, { kind: 'score', strict:true });
      }, failures);
      if (result.state==='delivered') sent.push(`${c.title} 시험 ${e.subject}`);
    }
  }
  return sent;
}
