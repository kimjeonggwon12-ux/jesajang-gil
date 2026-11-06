// 2026-11-06(사용자): "등록된 고유번호 아니면 못 들어오게, 출석 체크만 인식되게" — 아무 번호·이름(홍길동 2424)으로 들어가지던 것을 막는다.
// 입장 = 서버가 번호+이름을 명단(교사명단·관리자 명단)과 대조 → 맞으면 입장 표(token)를 준다.
// 앱은 모든 요청에 _tk 로 표를 싣고, api/index.js 가 표 없는 요청을 거절한다(출석 QR·예약 작업 등 PUBLIC 만 예외).
// 표 = HMAC(서버 비밀값, 'login:' + nid) — 서버에 따로 저장하지 않는다. 모두 다시 로그인시키려면 AUTH_VERSION 을 올린다.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { normId } from './util.js';

const AUTH_VERSION = 'v1';
const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const sign = (nid) => createHmac('sha256', secret()).update(`login:${AUTH_VERSION}:${nid}`).digest('base64url').slice(0, 32);

export const tokenFor = (memberId) => {
  const nid = normId(memberId);
  return `${nid}.${sign(nid)}`;
};

/** 표가 맞으면 그 사람의 nid, 아니면 null. */
export function tokenNid(tk) {
  const m = String(tk || '').match(/^(\d+)\.([A-Za-z0-9_-]{32})$/);
  if (!m || !secret()) return null;
  const want = Buffer.from(sign(m[1])), got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) ? m[1] : null;
}

// 표 없이 부를 수 있는 것: 입장 확인 / QR 출석(명단에 없는 분도 출석은 됨) / 접속 기록 / 핀 상태
export const PUBLIC_ACTIONS = new Set([
  'verifyLogin', 'getAttendMeeting', 'submitAttendance', 'getMyAttendance', 'getAttendCount', 'logVisit', 'pinStatus',
]);
