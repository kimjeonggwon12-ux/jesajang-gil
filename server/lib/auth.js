// 2026-11-06(사용자): "등록된 고유번호 아니면 못 들어오게, 출석 체크만 인식되게" — 아무 번호·이름(홍길동 2424)으로 들어가지던 것을 막는다.
// 입장 = 서버가 부서 + 고유번호 + 이름을 명단(교사명단·관리자 명단)과 대조 → 맞으면 입장 표(token)를 준다.
// 손님(명단에 없는 분) = 살아 있는 대화방 초대 링크가 있을 때만 손님 표 — 초대받은 대화방과 출석만 쓸 수 있다.
// 앱은 모든 요청에 _tk 로 표를 싣고, api/index.js 가 표 없는 요청을 거절한다(출석 QR·예약 작업 등 PUBLIC 만 예외).
// 표 = HMAC(서버 비밀값, 종류 + nid) — 서버에 따로 저장하지 않는다. 모두 다시 입장시키려면 AUTH_VERSION 을 올린다.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { normId } from './util.js';

const AUTH_VERSION = 'v2';   // v2(11/6 저녁): 부서까지 맞추기 — v1 표(번호+이름만)는 다시 입장
const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const sign = (kind, nid) => createHmac('sha256', secret()).update(`login:${AUTH_VERSION}:${kind}:${nid}`).digest('base64url').slice(0, 32);

/** kind: 'm' = 명단에 있는 교사·관리자, 'g' = 손님 */
export const tokenFor = (memberId, kind = 'm') => {
  const nid = normId(memberId);
  return `${kind}${nid}.${sign(kind, nid)}`;
};

/** 표가 맞으면 { nid, guest }, 아니면 null. */
export function tokenInfo(tk) {
  const m = String(tk || '').match(/^([mg])(\d+)\.([A-Za-z0-9_-]{32})$/);
  if (!m || !secret()) return null;
  const want = Buffer.from(sign(m[1], m[2])), got = Buffer.from(m[3]);
  return want.length === got.length && timingSafeEqual(want, got) ? { nid: m[2], guest: m[1] === 'g' } : null;
}

// 표 없이 부를 수 있는 것: 입장 확인 / 손님 입장 / QR 출석(명단에 없는 분도 출석은 됨) / 접속 기록 / 핀 상태
export const PUBLIC_ACTIONS = new Set([
  'verifyLogin', 'guestLogin', 'getAttendMeeting', 'submitAttendance', 'getMyAttendance', 'getAttendCount', 'logVisit', 'pinStatus',
]);
// 손님 표로 부를 수 있는 것: 초대받은 섭외자 대화방만
export const GUEST_ACTIONS = new Set([
  'getTargetRoom', 'sendRoomMessage', 'pinRoomMessage', 'deleteRoomMessage', 'leaveRoom', 'getRoomRecords', 'listMyRooms', 'joinRoomByCode',
]);
