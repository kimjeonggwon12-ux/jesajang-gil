// 입장할 때 고유번호를 잘못 넣은 사람 → 명단의 바른 번호. 폰에 옛 번호가 남아 있어도 모든 요청이 바른 번호로 들어간다.
// 기록을 옮길 때는 DB 의 member_id 도 함께 바꿀 것(app.html ID_FIX 와 같이 맞출 것).
import { normId } from './util.js';

const ID_ALIASES = {
  '271029000649': '00271029-00064',   // 11/1 부녀회 8지역 강정순 — 끝에 9를 더 넣어 입장
};
const ID_KEYS = ['memberId', 'creatorId', 'leaderId', 'helperId', 'toId', 'fromId'];

export function fixMemberIds(body) {
  for (const k of ID_KEYS) {
    const v = body[k];
    if (v && ID_ALIASES[normId(v)]) body[k] = ID_ALIASES[normId(v)];
  }
  return body;
}
