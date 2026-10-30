// 저장이 끝난 뒤 교사광장 봇으로 보내는 즉시 알림.
import { normId, kstDate } from './util.js';
import { sendAlert, teacherInfo, teacherHead, row } from './alerts.js';

// 점검용 시험 계정(ZZTEST…)의 저장은 실제 방에 알리지 않는다.
const isTestMember = (memberId) => String(memberId || '').startsWith('ZZTEST');
// 10/30(사용자): "활동 방에 개별 실시간 서머리는 올라오지 않게" — 저장마다 보내던 알림(활동·센터 인도·명함·도움 신청·광장 글·복음방/센터 도달)을 끈다.
//   아침 7시·정오·저녁 10시 서머리(bot.js)만 올린다. 다시 켜려면 true.
const INSTANT_ALERTS = false;

const DETAIL_MAX = 80;
const cut = (v) => {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > DETAIL_MAX ? s.slice(0, DETAIL_MAX) + '…' : s;
};

/** 활동 알림에 덧붙이는 기록 내용(적힌 항목만, 항목당 80자). */
function activityDetail(body) {
  const t = body.target || {};
  const lines = [
    ['📍', '단계', t.stage],
    ['💬', '상담', body.consultTitle],
    ['📖', '복음방', body.gospelSubject],
    ['🙂', '반응', [cut(body.reaction), cut(body.reactionNote)].filter(Boolean).join(' — ')],
    ['📝', '오늘 한 일', t.todayWork],
    ['➡️', '다음 할 일', t.nextWork],
    ['📌', '특이사항', t.note],
    ['❓', '문의', body.note],
  ].map(([icon, label, v]) => [icon, label, cut(v)]).filter(([, , v]) => v).map(([icon, label, v]) => row(icon, label, v));
  return lines.length ? '\n' + lines.join('\n') : '';
}

/** action 별 알림 글. 알릴 일이 아니면 null. */
function compose(action, body, result, head, memberId) {
  const d = body.data || body;
  switch (action) {
    case 'submitActivity': {
      const roles = Array.isArray(body.roles) ? body.roles.join('/') : '';
      const item = body.activityItem || (Array.isArray(body.activities) ? body.activities.join(', ') : '');
      return {
        kind: '활동기록',
        msg: `🔔 <b>활동 기록</b>\n${head}\n${row('🎭', '역할', roles)}\n${row('🗂️', '항목', item)}\n` +
          row('🙋', '대상자', body.target?.name || '-') + activityDetail(body),
      };
    }
    case 'submitCenterLead':
      return {
        kind: '센터인도',
        key: `센터인도|${normId(memberId)}|${String(body.leadName || '')}|${kstDate()}`,
        msg: `🏆 <b>센터 인도!</b>\n${head}\n${row('🙋', '대상자', body.leadName || '-')}\n✨ 대상자가 센터에 등록됐습니다`,
      };
    case 'saveConnectCard':
      if (result.updated) return null;   // 처음 등록할 때만 알린다
      return { kind: '명함등록', key: `명함|${normId(memberId)}`, msg: `👤 <b>명함 등록</b>\n${head}\n${row('💬', '한줄소개', d.oneLiner)}` };
    case 'saveHelpPost':
      if (d.helpId) return null;          // 고친 것은 알리지 않는다
      return { kind: '같이해요', msg: `📌 <b>같이 해요 등록</b>\n${head}\n${row('🗂️', '활동유형', d.type)}\n${row('💬', '한마디', d.oneLiner)}` };
    case 'savePlazaPost': {
      if (d.postId) return null;
      const category = d.category === '성공사례' || d.category === '실패사례' ? '사례' : d.category;
      return { kind: '교사광장글', msg: `✍️ <b>교사광장 글 등록</b>\n${head}\n${row('🏷️', '카테고리', category)}\n${row('📝', '제목', d.title)}` };
    }
    default:
      return null;
  }
}

/** 저장 action 이 끝난 뒤 부른다. 알림이 실패해도 result 는 그대로 돌려준다. */
export async function afterAction(action, body, result) {
  try {
    if (!INSTANT_ALERTS || !result?.ok) return result;
    const d = body.data || body;
    const memberId = body.memberId || d.memberId;
    if (isTestMember(memberId)) return result;
    const head = teacherHead(await teacherInfo(memberId, body.name || d.name));
    const alert = compose(action, body, result, head, memberId);
    if (alert) await sendAlert(alert.msg, alert.kind, alert.key);
  } catch (e) {
    console.log('[교사광장 봇] afterAction 오류 ' + e);
  }
  return result;
}

/** 전도 대상자가 복음방·센터수강 단계에 처음 도달하면 알린다(대상자마다 한 번). */
export async function onStageReached(memberId, targetId, fromStage, toStage) {
  try {
    if (!INSTANT_ALERTS || !toStage || toStage === fromStage || isTestMember(memberId)) return;
    const reached = {
      복음방: ['🎯 <b>복음방 도달!</b>', '✨ 대상자가 복음방 단계에 도달했습니다', '복음방도달', `복음방|${targetId}`],
      센터수강: ['🏆 <b>센터 인도!</b>', '✨ 대상자가 센터에 등록됐습니다', '센터인도', `센터|${targetId}`],
    }[toStage];
    if (!reached) return;
    const [title, text, kind, key] = reached;
    await sendAlert(`${title}\n${teacherHead(await teacherInfo(memberId))}\n${text}`, kind, key);
  } catch { /* 알림 실패는 무시 */ }
}
