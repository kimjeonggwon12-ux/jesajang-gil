import { createClient } from '@supabase/supabase-js';

let client;

/** 서비스 키로 붙는 Supabase 클라이언트(서버 전용). */
export function db() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

/** 오류를 예외로 바꿔 data 만 돌려준다. */
export async function run(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

/** DB 의 "겹치면 안 됨" 제약에 걸린 오류인가(동시에 같은 것을 두 번 넣으려 한 경우). */
export const isDuplicate = (err) => /duplicate key/i.test(String(err?.message || err));

const PAGE = 1000;

/**
 * 한 번에 1000행까지만 주는 API 제한을 넘어 전부 읽는다.
 * build() 는 순서가 고정된 쿼리를 새로 만들어 돌려줘야 한다.
 */
export async function selectAll(build, expectedPages = 1) {
  const rows = [];
  // 몇 쪽이 될지 짐작이 가면 그만큼은 한꺼번에 요청한다(차례로 기다리지 않게).
  for (let from = 0; ; from += PAGE * expectedPages) {
    const pages = await Promise.all(Array.from({ length: expectedPages }, (_, i) =>
      run(build().range(from + i * PAGE, from + (i + 1) * PAGE - 1))));
    for (const page of pages) rows.push(...page);
    if (pages.at(-1).length < PAGE) return rows;
  }
}
