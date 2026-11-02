// 화면 확인용 시험 데이터(운영 DB) — setup / clean
import { randomUUID } from 'node:crypto';
import { db, run } from '../server/lib/db.js';
import { kstDateTime } from '../server/lib/util.js';
import { actions as a } from '../server/registry.js';
const T = { memberId: 'ZZTEST-9100001', name: '시험교사S' }, L = { memberId: 'ZZTEST-9100002', name: '시험지역장' };
const HQ = { memberId: '20113000010', name: '관리자' };
const ids = [T.memberId, L.memberId];
if (process.argv[2] === 'setup') {
  await a.upsertRosterLeader({ ...T, dept: '기타', region: 'ZZ지역', position: '' });
  await a.upsertRosterLeader({ ...L, dept: '기타', region: 'ZZ지역', position: '지역장' });
  await run(db().from('teachers').update({ tier: '휴교사' }).eq('member_id', T.memberId));
  for (const nm of ['홍길동', '김영희']) {
    const tid = 'zztest-' + randomUUID();
    await run(db().from('targets').insert({ target_id: tid, creator_id: T.memberId, teacher_name: T.name, target_name: nm, stage: '복음방', created_at: kstDateTime(), updated_at: kstDateTime() }));
    await run(db().from('activities').insert({ member_id: T.memberId, name: T.name, submitted_at: kstDateTime(), activities: ['복음방'], roles: ['교사'], target_name: nm, target_stage: '복음방', today_work: '복음방 3과 진행' }));
    if (nm === '김영희') await a.requestCenterApproval({ ...T, targetId: tid, note: '11월 개강 희망' });
  }
  const c = await a.saveCenter({ ...HQ, name: 'ZZ시험센터', cohortNo: '1기', openMonth: '2026-11', staff: [{ ...L, role: '강사' }] });
  console.log('setup ok', c);
} else {
  const ts = await run(db().from('targets').select('target_id').in('creator_id', ids));
  const tids = ts.map((t) => t.target_id);
  if (tids.length) { await run(db().from('center_referrals').delete().in('target_id', tids)); await run(db().from('target_history').delete().in('target_id', tids)); await run(db().from('targets').delete().in('target_id', tids)); }
  await run(db().from('centers').delete().like('name', 'ZZ%'));
  await run(db().from('activities').delete().in('member_id', ids));
  await run(db().from('tier_history').delete().in('member_id', ids));
  await run(db().from('teachers').delete().in('member_id', ids));
  console.log('clean ok');
}
