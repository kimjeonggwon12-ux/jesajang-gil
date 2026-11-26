// 격리 합성 PostgreSQL 에 붙는 아주 작은 supabase-js 대용(시험 전용). from().select().eq()… 와 rpc() 만 흉내 낸다.
// 운영 주소를 막기 위해 127.0.0.1/localhost 이면서 DB 이름에 'synth' 가 든 주소만 받는다.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export function guardUrl(url) {
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname) || !/synth/.test(u.pathname)) throw new Error('합성 DB(127.0.0.1, 이름에 synth)만 사용할 수 있어요.');
  return url;
}
export async function pgPool(url, max = 6) {
  const pg = (await import(process.env.EDU_MGMT_PG_MODULE || 'pg')).default;
  return new pg.Pool({ connectionString: guardUrl(url), max });
}
const repo = fileURLToPath(new URL('../../', import.meta.url));
/** 기존 마이그레이션 전부 + 제안 SQL 을 새 스키마에 적용(합성 DB 전용). */
export async function rebuild(pool, proposals = []) {
  const c = await pool.connect();
  try {
    await c.query(`drop schema if exists public cascade; create schema public;
      do $$ begin
        if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      end $$; grant usage on schema public to anon,authenticated,service_role;`);
    const dir = join(repo, 'supabase/migrations');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await c.query(readFileSync(join(dir, f), 'utf8'));
    for (const f of proposals) await c.query(readFileSync(join(repo, f), 'utf8'));
  } finally { c.release(); }
}

const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('bad identifier ' + s); return '"' + s + '"'; };
class Q {
  constructor(pool, table) { this.pool = pool; this.table = table; this.where = []; this.args = []; this.orders = []; this.cols = '*'; this.lim = null; this.off = null; }
  select(cols = '*') { this.cols = cols === '*' ? '*' : cols.split(',').map((c) => ident(c.trim())).join(','); return this; }
  #op(col, op, v) { this.args.push(v); this.where.push(`${ident(col)} ${op} $${this.args.length}`); return this; }
  eq(c, v) { return this.#op(c, '=', v); }
  neq(c, v) { return this.#op(c, '<>', v); }
  gte(c, v) { return this.#op(c, '>=', v); }
  lte(c, v) { return this.#op(c, '<=', v); }
  lt(c, v) { return this.#op(c, '<', v); }
  in(c, v) { this.args.push(v); this.where.push(`${ident(c)} = any($${this.args.length})`); return this; }
  order(c, o = {}) { this.orders.push(`${ident(c)} ${o.ascending === false ? 'desc' : 'asc'}`); return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.off = a; this.lim = b - a + 1; return this; }
  then(ok, bad) {
    const sql = `select ${this.cols} from public.${ident(this.table)}${this.where.length ? ' where ' + this.where.join(' and ') : ''}${this.orders.length ? ' order by ' + this.orders.join(',') : ''}${this.lim != null ? ' limit ' + this.lim : ''}${this.off != null ? ' offset ' + this.off : ''}`;
    return this.pool.query(sql, this.args).then((r) => ({ data: r.rows, error: null }), (e) => ({ data: null, error: { message: e.message } })).then(ok, bad);
  }
}
export function adapter(pool) {
  return {
    from: (t) => new Q(pool, t),
    rpc(name, args = {}) {
      const keys = Object.keys(args);
      const sql = `select public.${ident(name)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(',')}) as r`;
      const vals = keys.map((k) => (args[k] && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
      return pool.query(sql, vals).then((r) => ({ data: r.rows[0].r, error: null }), (e) => ({ data: null, error: { message: e.message } }));
    },
  };
}
