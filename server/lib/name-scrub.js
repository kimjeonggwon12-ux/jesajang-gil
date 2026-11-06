// 2026-11-06(사용자): "대상자(섭외자)의 이름이 기록된 경우는 제거 — 글 중간중간 들어가는 섭외자 이름도".
// 담당 교사(들)의 섭외자 이름 목록을 알고 있으니, 글 어디에 나오든 홍○동처럼 가린다(첫 낱말도 — '홍길동(직장)' → 홍○동).
// 담당 본인이 보는 화면은 그대로, 남(초대받은 분·다른 교사·텔레그램)이 보는 것만 가린다. DB 원본은 고치지 않는다.
import { db, run } from './db.js';
import { normId } from './util.js';
// report-room.js 의 maskName 과 같은 규칙(서로 불러오면 순환이 생겨 여기 따로 둠)
const maskName = (n) => { const first = String(n || '').replace(/^#/, '').trim().split(/[\s(（/·,]/)[0]; const a = [...first]; if (a.length <= 1) return first; return a.length === 2 ? a[0] + '○' : a[0] + '○'.repeat(a.length - 2) + a[a.length - 1]; };

const namesOf = (raw) => {
  const s = String(raw || '').replace(/^#/, '').trim();
  const first = s.split(/[\s(（/·,]/)[0];
  return [s, first].filter((x) => [...x].length >= 2);
};

/** 이 교사들(번호)의 섭외자 이름 목록(긴 것부터). */
export async function targetNamesOf(memberIds, extra = []) {
  const nids = [...new Set(memberIds.filter(Boolean).map(normId).filter((n) => n && n !== '0'))];
  const set = new Set(extra.flatMap(namesOf));
  if (nids.length) {
    const or = nids.map((n) => `creator_nid.eq.${n},leader_nid.eq.${n},helper_nid.eq.${n}`).join(',');
    const rows = await run(db().from('targets').select('target_name').or(or).limit(5000)).catch(() => []);
    rows.forEach((r) => namesOf(r.target_name).forEach((n) => set.add(n)));
  }
  return [...set].sort((a, b) => b.length - a.length);
}

/** 여러 교사의 섭외자 이름을 교사별로(광장 목록처럼 글쓴이가 여럿일 때 한 번에). */
export async function targetNamesByOwner(memberIds) {
  const nids = [...new Set(memberIds.filter(Boolean).map(normId).filter((n) => n && n !== '0'))];
  const map = new Map(nids.map((n) => [n, new Set()]));
  if (!nids.length) return new Map();
  const list = nids.join(',');
  const rows = await run(db().from('targets').select('target_name, creator_nid, leader_nid, helper_nid')
    .or(`creator_nid.in.(${list}),leader_nid.in.(${list}),helper_nid.in.(${list})`).limit(10000)).catch(() => []);
  for (const r of rows) for (const n of [r.creator_nid, r.leader_nid, r.helper_nid]) if (map.has(n)) namesOf(r.target_name).forEach((x) => map.get(n).add(x));
  return new Map([...map].map(([n, set]) => [n, [...set].sort((a, b) => b.length - a.length)]));
}

/** 글 속 섭외자 이름 → 홍○동 ('#홍길동' 꼴도). */
export function scrubNames(text, names) {
  let s = String(text ?? '');
  if (!s || !names || !names.length) return s;
  for (const n of names) if (s.includes(n)) s = s.split('#' + n).join(maskName(n)).split(n).join(maskName(n));
  return s;
}

/** 객체 안의 모든 글(문자열)을 가린다 — skip 에 든 칸 이름은 그대로(번호·주소 등). */
export function scrubDeep(x, names, skip = SKIP) {
  if (!names || !names.length) return x;
  if (Array.isArray(x)) return x.map((v) => scrubDeep(v, names, skip));
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x)) o[k] = skip.has(k) ? x[k] : scrubDeep(x[k], names, skip);
    return o;
  }
  return typeof x === 'string' ? scrubNames(x, names) : x;
}
const SKIP = new Set(['id', 'key', 'targetId', 'postId', 'commentId', 'memberId', 'photo', 'photos', 'thumb', 'authorPhoto', 'at', 'createdAt', 'updatedAt', 'raw', 'code']);
