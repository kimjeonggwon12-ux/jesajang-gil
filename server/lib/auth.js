// 만료가 있는 v3 로그인 표. DB 키와 분리한 AUTH_SIGNING_KEY가 필요하다.
// 이전 무기한 표는 받지 않는다. PIN 상태 변경은 요청마다 확인한다.
import { createHmac, timingSafeEqual, randomBytes, createHash } from 'node:crypto';
import { normId } from './util.js';

const MEMBER_TTL = 12 * 60 * 60, GUEST_TTL = 2 * 60 * 60;
const secret = () => {
  const key = process.env.AUTH_SIGNING_KEY || '';
  if (Buffer.byteLength(key) < 32 || key === process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('로그인 서명 키를 별도로 설정해야 합니다.');
  }
  return key;
};
const sign = (text) => createHmac('sha256', secret()).update('login:v3:' + text).digest('base64url');
export const pinVersion = (row) => row
  ? createHash('sha256').update(JSON.stringify([row.ver, row.salt, row.pin_hash])).digest('base64url') : '';

export function tokenFor(memberId, kind = 'm', options = {}) {
  const nid = normId(memberId), now = Math.floor(Date.now() / 1000);
  if (!/^[1-9]\d{0,39}$/.test(nid) || !['m', 'g'].includes(kind)) throw new Error('로그인 정보를 확인해 주세요.');
  if (kind === 'g' && !options.roomId) throw new Error('초대받은 방을 확인해 주세요.');
  const claims = {
    v: 3, iat: now, exp: now + (kind === 'g' ? GUEST_TTL : MEMBER_TTL),
    pv: options.pinVersion || '', nonce: randomBytes(16).toString('base64url'),
    ...(kind === 'g' ? { room: options.roomId, name: String(options.name || '').slice(0, 20) } : {}),
  };
  const value = `${kind}${nid}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return `${value}.${sign(value)}`;
}

export function tokenInfo(tk) {
  if (typeof tk !== 'string' || tk.length > 2048) return null;
  const m = tk.match(/^([mg])([1-9]\d{0,39})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/);
  if (!m) return null;
  const want = Buffer.from(sign(`${m[1]}${m[2]}.${m[3]}`)), got = Buffer.from(m[4]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const c = JSON.parse(Buffer.from(m[3], 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000), ttl = m[1] === 'g' ? GUEST_TTL : MEMBER_TTL;
    if (c.v !== 3 || !Number.isInteger(c.iat) || !Number.isInteger(c.exp) || c.iat > now + 30
      || c.exp <= now || c.exp <= c.iat || c.exp - c.iat > ttl || typeof c.pv !== 'string') return null;
    if (m[1] === 'g' && (typeof c.room !== 'string' || !c.room)) return null;
    return { nid: m[2], guest: m[1] === 'g', pinVersion: c.pv, roomId: c.room, name: c.name, expiresAt: c.exp };
  } catch { return null; }
}

export const PUBLIC_ACTIONS = new Set([
  'verifyLogin', 'guestLogin', 'registerPin', 'recoverPin', 'getAttendMeeting', 'submitAttendance', 'getAttendCount', 'logVisit',
]);
export const GUEST_ACTIONS = new Set([
  'getTargetRoom', 'sendRoomMessage', 'roomFileUpload', 'pinRoomMessage', 'deleteRoomMessage',
  'leaveRoom', 'getRoomRecords', 'listMyRooms', 'joinRoomByCode',
]);
export const CRON_ACTIONS = new Set([
  'backupNow', 'attAutoSummary', 'vtAuto', 'tierAutoRest', 'tsNewsSend', 'tsRoomHealth',
  'tsDailySummary', 'tsActivitySummary', 'tsEveningSummary', 'tsNoonSummary', 'tsStatusSummary',
  'tsStatus', 'tsTest', 'tsTestRoom', 'tsEduAttTest', 'tsEduAttSend', 'tsJungjinTest',
]);
