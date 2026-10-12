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

const PAGE = 1000;

/**
 * 한 번에 1000행까지만 주는 API 제한을 넘어 전부 읽는다.
 * build() 는 순서가 고정된 쿼리를 새로 만들어 돌려줘야 한다.
 */
export async function selectAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const page = await run(build().range(from, from + PAGE - 1));
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}
