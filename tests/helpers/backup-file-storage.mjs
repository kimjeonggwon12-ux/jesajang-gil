// Supabase SDK는 그대로 실행하고 Storage HTTP만 로컬 파일 저장소로 대체한다.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
export function fileStorage() {
  const root = mkdtempSync('/tmp/jesajang-backup-monitor-');
  const state = { root, exists: true, public: false, fault: '', calls: [], blocked: 0, receivedBytes: 0 };
  const file = name => { assert.ok(!name.includes('..') && !name.startsWith('/')); return path.join(root, name); };
  const json = (body, status = 200) => Response.json(body, { status });
  const absent = () => json({ message: 'Object not found', statusCode: '404' }, 400);
  async function fetch(input, init) {
    const req = new Request(input, init), url = new URL(req.url), method = req.method, p = decodeURIComponent(url.pathname);
    assert.equal(url.origin, 'http://backup.fixture.invalid');
    state.calls.push({ method, path: p });
    if (state.fault === 'offline') return json({ message: 'Unavailable', statusCode: '503' }, 503);
    if (p === '/storage/v1/bucket/backups' && method === 'GET') return state.exists ? json({ id: 'backups', name: 'backups', public: state.public }) : absent();
    if (p === '/storage/v1/bucket' && method === 'POST') { state.exists = true; return json({ name: 'backups' }); }
    if (!state.exists) return absent();
    if (p.startsWith('/storage/v1/object/sign/backups/') && method === 'POST') {
      const name = p.slice('/storage/v1/object/sign/backups/'.length);
      return existsSync(file(name)) ? json({ signedURL: `/object/sign/backups/${name}?token=fixture-only` }) : absent();
    }
    if (p === '/storage/v1/object/list/backups' && method === 'POST') {
      if (state.fault === 'list') return json({ message: 'List failed' }, 503);
      const body = await req.json(), dir = file(body.prefix || '');
      const names = existsSync(dir) ? readdirSync(dir).filter(name => !body.search || name.includes(body.search)).sort().reverse() : [];
      return json(names.slice(body.offset || 0, (body.offset || 0) + body.limit).map(name => {
        const stat = statSync(path.join(dir, name));
        return { name, id: stat.isDirectory() ? null : name, metadata: stat.isDirectory() ? null : { size: stat.size }, created_at: stat.birthtime.toISOString() };
      }));
    }
    if (p === '/storage/v1/object/backups' && method === 'DELETE') {
      if (state.fault === 'remove') return json({ message: 'Remove failed' }, 503);
      const body = await req.json();
      for (const name of body.prefixes) if (existsSync(file(name)) && state.fault !== 'false_remove') unlinkSync(file(name));
      return json([]);
    }
    const object = p.match(/^\/storage\/v1\/object\/(?:authenticated\/)?backups\/(.+)$/);
    if (object && ['GET', 'POST'].includes(method)) {
      const name = object[1], target = file(name), archive = name.endsWith('.json.gz');
      if (method === 'GET') {
        if (state.fault === 'result_read' && name.endsWith('.result.json')) return json({ message: 'Read failed' }, 503);
        return existsSync(target) ? new Response(readFileSync(target), { headers: { 'Content-Type': archive ? 'application/gzip' : 'application/json' } }) : absent();
      }
      assert.equal(req.headers.get('x-upsert'), 'false');
      if (existsSync(target)) return json({ message: 'Already exists' }, 409);
      if ((archive && state.fault === 'upload') || (state.fault === 'result_write' && name.endsWith('.result.json')) || (state.fault === 'start_write' && name.endsWith('.started.json'))) return json({ message: 'Write failed' }, 503);
      let bytes = Buffer.from(await req.arrayBuffer());
      if (archive && state.fault === 'corrupt') { bytes = Buffer.from(bytes); bytes[0] ^= 1; }
      if (!(archive && state.fault === 'false_upload')) { mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, bytes, { mode: 0o600 }); }
      return json({ Key: 'backups/' + name });
    }
    state.blocked++;
    throw new Error('Unexpected fixture request: ' + method + ' ' + p);
  }
  const client = createClient('http://backup.fixture.invalid', 'local-fixture-service-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (...args) => {
    const response = await fetch(...args); state.receivedBytes += (await response.clone().arrayBuffer()).byteLength; return response;
  } } });
  return { client, state, file, fetch };
}
