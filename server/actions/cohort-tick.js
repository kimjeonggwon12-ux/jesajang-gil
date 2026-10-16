// 교육 과정 자동 서머리(5분마다 attAutoSummary 가 부른다): 정해진 시각이 지나면 과정 텔레그램 방으로 결과를 보낸다.
//   출석 — 그날 출석 모임이 끝나고 10분 뒤: 출석 n/전체, 지각, 결석 명단
//   과제 — 그날 낼 과제의 마감 시각(비면 23:55)이 지나면: 제출 n/전체, 늦게 낸 사람, 미제출 명단
//   시험 — 그날 시험의 점수 마감 시각(비면 23:55)이 지나면: 점수 n/전체, 평균·최고, 점수 목록, 미입력 명단
// 같은 서머리는 cohort_summary_log 로 한 번만 보낸다.
import { db, run } from '../lib/db.js';
import { normId, kstDate, kstDateTime } from '../lib/util.js';
import { sendAttendText } from '../lib/attend-bot.js';
import { toCohort, weekdayOf, isClassDay, assignmentOn } from '../lib/cohort.js';
import { toAssignment, toExam, examOn, cohortAbsenceLines } from './cohorts.js';

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
const plus10 = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); const x = h * 60 + m + 10; return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

/** 처음 보내는 서머리면 true(기록을 남김), 이미 보냈으면 false. */
async function claim(cohortId, kind, refId, date) {
  const { error } = await db().from('cohort_summary_log').insert({ cohort_id: cohortId, kind, ref_id: refId, date, sent_at: kstDateTime() });
  return !error;
}

export async function cohortTick() {
  const today = kstDate();
  const hm = kstDateTime().slice(11, 16);
  const sent = [];
  const cohorts = (await run(db().from('cohorts').select('*').eq('status', '진행'))).map(toCohort);
  for (const c of cohorts) {
    if (!c.tgChat) continue;   // 방이 연결된 과정만
    const members = await run(db().from('cohort_members').select('*').eq('cohort_id', c.cohortId).order('church').order('name'));
    if (!members.length) continue;
    const total = members.length;
    const title = `[${c.title}] ${mmdd(today)}(${weekdayOf(today)})`;

    // ── 출석 ──
    if (c.useAttend) {
      const meetings = await run(db().from('attend_meetings').select('*').eq('cohort_id', c.cohortId).eq('date', today).neq('status', '삭제'));
      for (const m of meetings) {
        if (!m.end_time || hm < plus10(m.end_time)) continue;
        if (!(await claim(c.cohortId, '출석', m.meeting_id, today))) continue;
        await run(db().from('attend_meetings').update({ status: '집계완료', updated_at: kstDateTime() }).eq('meeting_id', m.meeting_id));
        const recs = await loadRecords((q) => q.eq('meeting_id', m.meeting_id));
        const byNid = new Map(recs.map((r) => [normId(r.memberId), r]));
        const came = members.filter((x) => byNid.has(x.nid));
        const late = came.filter((x) => /지각/.test(byNid.get(x.nid).late || ''));
        const part = came.filter((x) => /결석|조퇴|외출/.test(byNid.get(x.nid).late || ''));
        const absent = members.filter((x) => !byNid.has(x.nid));
        await sendAttendText([
          `📋 ${title} 출석 마감 (${String(m.start_time).slice(0, 5)}~${String(m.end_time).slice(0, 5)})`,
          `✅ 출석 ${came.length}/${total}명 (${Math.round((came.length / total) * 100)}%)`,
          late.length ? `⏰ 지각 ${late.length}명: ${late.map((x) => `${x.name} ${byNid.get(x.nid).late}`).join(', ')}` : '',
          part.length ? `◐ 부분 결석 ${part.length}명: ${part.map((x) => `${x.name} ${byNid.get(x.nid).late}`).join(', ')}` : '',
          absent.length ? `❌ 결석 ${absent.length}명: ${names(absent)}` : '🎉 전원 출석!',
        ].filter(Boolean).concat(await absenceBlock(c)).join('\n'), c.tgChat);
        sent.push(`${c.title} 출석`);
      }
    }

    // ── 과제 ──
    if (c.useAssign && isClassDay({ ...c, days: '' }, today)) {
      const asg = (await run(db().from('cohort_assignments').select('*').eq('cohort_id', c.cohortId).eq('status', '열림'))).map(toAssignment);
      for (const a of asg) {
        const repeat = a.repeat !== '한번';
        if (repeat ? !assignmentOn(a, today) : a.due !== today) continue;
        if (hm < (a.dueTime || '23:55')) continue;
        if (!(await claim(c.cohortId, '과제', a.assignmentId, today))) continue;
        const subs = await run(db().from('cohort_submissions').select('nid, late').eq('assignment_id', a.assignmentId).eq('work_date', repeat ? today : ''));
        const done = new Map(subs.map((s) => [s.nid, s]));
        const ok = members.filter((x) => done.has(x.nid));
        const late = ok.filter((x) => done.get(x.nid).late);
        const missing = members.filter((x) => !done.has(x.nid));
        await sendAttendText([
          `📝 ${title} 과제 마감 — ${a.title} (${a.dueTime || '자정'})`,
          `✅ 제출 ${ok.length}/${total}명 (${Math.round((ok.length / total) * 100)}%)`,
          late.length ? `⏰ 늦게 냄 ${late.length}명: ${names(late)}` : '',
          missing.length ? `❌ 미제출 ${missing.length}명: ${names(missing)}` : '🎉 전원 제출!',
        ].filter(Boolean).join('\n'), c.tgChat);
        sent.push(`${c.title} 과제 ${a.title}`);
      }
    }

    // ── 시험 ──
    const exams = (await run(db().from('cohort_exams').select('*').eq('cohort_id', c.cohortId).eq('status', '열림'))).map(toExam);
    for (const e of exams) {
      if (!examOn(e, today) || !isClassDay({ ...c, days: '' }, today)) continue;
      if (hm < (e.dueTime || '23:55')) continue;
      if (!(await claim(c.cohortId, '시험', e.examId, today))) continue;
      const scores = (await run(db().from('cohort_scores').select('nid, name, score, subject').eq('cohort_id', c.cohortId).eq('date', today)))
        .filter((s) => key(s.subject) === key(e.subject));
      const byNid = new Map(scores.map((s) => [s.nid, Number(s.score)]));
      const got = members.filter((x) => byNid.has(x.nid)).sort((x, y) => byNid.get(y.nid) - byNid.get(x.nid));
      const missing = members.filter((x) => !byNid.has(x.nid));
      const vals = got.map((x) => byNid.get(x.nid));
      const avg = vals.length ? Math.round((vals.reduce((p, q) => p + q, 0) / vals.length) * 10) / 10 : 0;
      await sendAttendText([
        `🧪 ${title} 시험 결과 — ${e.subject}`,
        `✅ 점수 ${got.length}/${total}명${vals.length ? ` · 평균 ${avg} · 최고 ${Math.max(...vals)} · 최저 ${Math.min(...vals)}` : ''}`,
        got.length ? got.map((x, i) => `${i + 1}. ${x.name} ${byNid.get(x.nid)}`).join('\n') : '',
        missing.length ? `❌ 점수 없음 ${missing.length}명: ${names(missing)}` : '',
      ].filter(Boolean).join('\n'), c.tgChat);
      sent.push(`${c.title} 시험 ${e.subject}`);
    }
  }
  return sent;
}
