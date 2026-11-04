// Gemini 호출. 실패해도 예외 대신 안내 문구가 든 응답을 돌려준다(화면이 그대로 보여 준다).
import { AsyncLocalStorage } from 'node:async_hooks';
import { db, run } from './db.js';
import { normId } from './util.js';

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const FALLBACK = '⚠️ AI 응답을 받아오지 못했습니다. 잠시 후 다시 시도해주세요.';

// ── 11/4 개인정보(가명 처리): AI(구글 서버)로 나가는 글에서 섭외자 이름·연락처를 가린다 ──
//   요청한 교사의 섭외자 이름 → '섭외자A·B…'(같은 사람은 같은 글자), 전화번호·주민번호 모양 → 가림.
//   답이 돌아오면 '섭외자A'를 다시 실제 이름으로 바꿔 화면엔 그대로 보인다(이름은 구글로 나가지 않음).
//   registry.js 가 AI 기능(action)마다 withPrivacy 로 감싼다.
const privacy = new AsyncLocalStorage();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const codeOf = (i) => '섭외자' + (i < 26 ? CODES[i] : CODES[Math.floor(i / 26) - 1] + CODES[i % 26]);

/** body.memberId 의 섭외자 이름(+ body.targetName)을 모아 이 요청 동안 가린다. */
export async function withPrivacy(body, fn) {
  const names = new Set();
  const add = (n) => {
    const s = String(n || '').replace(/^#/, '').trim();
    if (s.length >= 2) names.add(s);
    const first = s.split(/[\s(（/·,]/)[0];
    if (first && first.length >= 2) names.add(first);
  };
  add(body && body.targetName);
  try {
    const nid = normId(body && body.memberId);
    if (nid && nid !== '0') {
      const rows = await run(db().from('targets').select('target_name')
        .or(`creator_nid.eq.${nid},leader_nid.eq.${nid},helper_nid.eq.${nid}`).limit(1000));
      rows.forEach((r) => add(r.target_name));
    }
  } catch (e) { console.log('AI 가명 처리 이름 읽기 실패: ' + e.message); }
  const list = [...names].sort((a, b) => b.length - a.length);
  return privacy.run({ list, map: new Map() }, fn);
}

export function scrubText(t, store) {
  let s = String(t);
  if (store) {
    for (const name of store.list) {
      if (!s.includes(name)) continue;
      if (!store.map.has(name)) {
        // 첫 낱말(예: '홍길동(직장)' → '홍길동')은 전체 이름과 같은 글자를 쓴다
        const full = [...store.map.keys()].find((k) => k.startsWith(name));
        store.map.set(name, full ? store.map.get(full) : codeOf(new Set(store.map.values()).size));
      }
      s = s.replace(new RegExp(reEsc(name), 'g'), store.map.get(name));
    }
  }
  return s
    .replace(/01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[연락처]')
    .replace(/\d{6}\s?-\s?[1-4]\d{6}/g, '[주민번호]')
    .replace(/(뒷자리\s*:?\s*)\d{4}/g, '$1[가림]');
}
function scrubPayload(payload, store) {
  const walk = (v) => (typeof v === 'string' ? scrubText(v, store) : Array.isArray(v) ? v.map(walk)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'inlineData' || k === 'inline_data' ? x : walk(x)])) : v);
  const out = { ...payload, contents: walk(payload.contents) };
  if (payload.systemInstruction) out.systemInstruction = walk(payload.systemInstruction);
  if (payload.system_instruction) out.system_instruction = walk(payload.system_instruction);
  return out;
}
export function unscrub(result, store) {
  if (!store || !store.map.size || !result || !result.candidates) return result;
  const back = new Map();
  for (const [name, code] of store.map) if (!back.has(code) || back.get(code).length < name.length) back.set(code, name);
  const codes = [...back.keys()].sort((a, b) => b.length - a.length);
  const fix = (s) => codes.reduce((x, c) => x.replace(new RegExp(c + '(?![A-Z])', 'g'), back.get(c)), s);
  for (const c of result.candidates) for (const p of (c.content && c.content.parts) || []) if (typeof p.text === 'string') p.text = fix(p.text);
  return result;
}

async function callOnce(payload, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || DEFAULT_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const store = privacy.getStore();
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scrubPayload(payload || {}, store)) });
    return unscrub(await r.json(), store);
  } catch (e) {
    return { error: { message: String(e.message || e) } };
  }
}

/** 붐빌 때(503)는 1초 쉬고 두 번 더 해 본다. */
async function callWithRetry(payload, model) {
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    result = await callOnce(payload, model);
    if (result?.error?.code !== 503) return result;
    if (attempt < 3) await new Promise((ok) => setTimeout(ok, 1000));
  }
  return result;
}

function friendlyError(result) {
  const code = result?.error?.code;
  const msg = result?.error?.message || '';
  if (code === 503 || code === 529 || /UNAVAILABLE|overloaded|high demand/i.test(msg)) {
    return '⚠️ AI가 지금 많이 몰려서 응답이 지연되고 있어요. 자동으로 3번 다시 시도했지만 계속 실패했습니다 — 잠시 후 다시 시도해주세요.';
  }
  return FALLBACK + (msg ? ` (${msg})` : '');
}

export const textOf = (result) => result?.candidates?.[0]?.content?.parts?.[0]?.text;

/** Gemini 응답 모양 그대로. 실패하면 같은 모양에 안내 문구를 담는다. */
export async function callAi(payload, model) {
  const result = await callWithRetry(payload, model);
  if (typeof textOf(result) === 'string') return result;
  return { candidates: [{ content: { parts: [{ text: friendlyError(result) }] } }] };
}

/** 글 한 덩이를 보내고 답 글만 받는다. */
export async function askAi(prompt) {
  const result = await callAi({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
  return textOf(result) ?? FALLBACK;
}

/**
 * 모델을 차례로 써 본다 — 붐빔(503)·하루 한도(429)면 다음 모델로. 다 안 되면 안내 문구.
 * 2026-10-20: 무료 등급 gemini-3-flash-preview(AI상담 기본)는 하루 20회라, 다른 기능은 다른 모델을 앞에 둔다.
 */
export async function askAiModels(prompt, models) {
  let result;
  for (const model of models) {
    result = await callWithRetry({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }, model);
    const text = textOf(result);
    if (typeof text === 'string') return text;
    const code = result?.error?.code;
    if (code !== 429 && code !== 503 && code !== 404) break;
  }
  if (result?.error?.code === 429) return '⚠️ 오늘 AI 사용 한도를 다 썼어요. 내일 다시 시도해 주세요.';
  return friendlyError(result);
}
