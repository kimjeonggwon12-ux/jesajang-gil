// 시트 "교관명단" 탭(관리자 명단)을 Supabase admins 표로 옮긴다.
// 표가 비어 있을 때만 넣는다(이미 있으면 아무것도 하지 않고 멈춘다).
//   node --env-file=.env tools/import-admins.mjs
import { db, run } from '../server/lib/db.js';
import { readTab, text } from './lib/sheets.mjs';

const { count } = await db().from('admins').select('*', { count: 'exact', head: true });
if (count) {
  console.log('admins 표에 이미', count, '명이 있어 넣지 않았습니다.');
  process.exit(0);
}

const records = readTab('교관명단')
  .filter((r) => text(r['고유번호']).replace(/\D/g, '').length >= 5)   // 고유번호 없는 줄은 관리자가 아니다
  .map((r) => ({
    no: text(r['번호']), dept: text(r['부서']), region: text(r['지역']), district: text(r['구역']),
    affiliation: text(r['소속']), member_id: text(r['고유번호']), name: text(r['이름']),
    position: text(r['직책']), phone: text(r['연락처']),
  }));

await run(db().from('admins').insert(records));
console.log('admins:', records.length, '명');
