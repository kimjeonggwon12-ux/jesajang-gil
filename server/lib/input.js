// 화면에서 받은 값을 다듬는 공통 도구
import { kstDateTime } from './util.js';

/** 앞뒤 공백을 떼고 max 글자까지만. */
export const clip = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);

/** 중복·빈 값을 뺀 목록. allowed 가 있으면 그 안의 값만. */
export function pickList(arr, allowed, max = 30) {
  const out = [];
  for (const raw of Array.isArray(arr) ? arr : []) {
    const x = String(raw || '').trim();
    if (!x || out.includes(x) || (allowed && !allowed.includes(x))) continue;
    out.push(x);
  }
  return out.slice(0, max);
}

/** 새 번호: 머리글자 + yyMMddHHmmss + 세 자리 난수 (예: PZ261012103000123). */
export function newId(prefix) {
  const stamp = kstDateTime().replace(/\D/g, '').slice(2);
  return prefix + stamp + Math.floor(Math.random() * 900 + 100);
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
