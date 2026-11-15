// 실제 PostgreSQL + PostgREST + 앱 HTTP API. 운영 자격 증명·명단을 사용하지 않는다.
import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {seed,sql,quote,ids,PIN,api,login,register,issue,recover,jwt} from './helpers/local-db.mjs';
beforeEach(seed);
test('정보 대조 최초 등록·입장·중복 등록 거절',async()=>{
  const noPin=await login(ids.fresh,'테스트등록');assert.equal(noPin.body.needsRegistration,true);assert.equal(noPin.body.token,undefined);
  const r=await register();assert.equal(r.body.ok,true,JSON.stringify(r));assert.ok(r.body.token);
  assert.equal((await api('pinStatus',{},r.body.token)).body.hasPin,true);
  assert.equal((await login(ids.fresh,'테스트등록')).body.ok,true);
  assert.ok((await register({pin:'693857'})).body.error);
  assert.equal((await login(ids.fresh,'테스트등록')).body.ok,true);
  assert.equal(sql("select count(*) from roster_changes where kind='PIN 최초 등록'"),'1');
  assert.equal(sql(`select phone||':'||source from member_registration_contacts where nid='${ids.fresh}'`),'01000000006:existing_roster');
  assert.equal(sql(`select phone from teacher_profiles where nid='${ids.fresh}'`),'010-0000-0006');
});
test('이름·부서·고유번호·기존 전화 불일치는 등록 거절',async()=>{
  for (const extra of [{name:'다른이름'},{dept:'장년회'},{memberId:'9900000000999'},{phone:'01000000009'}]) {const r=await register(extra);assert.equal(r.status,200,JSON.stringify(r));assert.ok(r.body.error,JSON.stringify(r));assert.equal(r.body.token,undefined);}
  assert.equal(sql(`select count(*) from member_pins where nid='${ids.fresh}'`),'0');
  assert.equal(sql('select count(*) from member_registration_contacts'),'0');
});
test('전화 없는 계정은 명단 일치 후 새 번호와 PIN을 함께 등록하고 번호는 미인증으로 보관',async()=>{
  for(const stored of [undefined,'','   ']) {
    seed();
    if(stored!==undefined)sql(`insert into teacher_profiles(member_id,phone) values('${ids.missing}',${quote(stored)})`);
    const extra={memberId:ids.missing,name:'테스트미등록',phone:'+82 10-0000-0007'};
    for(const wrong of [{name:'다른이름'},{dept:'장년회'},{phone:'12345'}])assert.ok((await register({...extra,...wrong})).body.error);
    assert.equal(sql(`select count(*) from member_registration_contacts where nid='${ids.missing}'`),'0');
    const r=await register(extra);assert.equal(r.body.ok,true,JSON.stringify(r));
    assert.equal((await login(ids.missing,'테스트미등록')).body.ok,true);
    const contact=JSON.parse(sql(`select row_to_json(c) from member_registration_contacts c where nid='${ids.missing}'`));
    assert.equal(contact.phone,'01000000007');assert.equal(contact.source,'self_reported');assert.equal(contact.phone_verified_at,null);assert.equal(contact.invalidated_at,null);
    assert.equal(sql(`select count(*) from teacher_profiles where nid='${ids.missing}' and btrim(coalesce(phone,''))<>''`),'0');
    const log=sql('select row_to_json(r) from roster_changes r');assert.ok(log.includes('self_reported'));assert.ok(!log.includes(contact.phone));
  }
});
test('형식이 잘못된 기존 연락처는 번호 없음으로 우회하지 않는다',async()=>{
  sql(`insert into teacher_profiles(member_id,phone) values('${ids.missing}','확인 필요')`);
  assert.ok((await register({memberId:ids.missing,name:'테스트미등록',phone:'01000000007'})).body.error);
  assert.equal(sql(`select count(*) from member_pins where nid='${ids.missing}'`),'0');
});
test('국제번호와 구분 기호를 정규화하고 등록 시도 5회 제한',async()=>{
  assert.equal((await register({phone:'+82 10-0000-0006'})).body.ok,true);
  seed();for(let i=0;i<5;i++)assert.ok((await register({phone:'01000000009'})).body.error);
  assert.equal((await register()).body.locked,true);
  for(let i=0;i<5;i++)assert.ok((await register({memberId:ids.missing,name:'다른이름'})).body.error);
  assert.equal((await register({memberId:ids.missing,name:'테스트미등록'})).body.locked,true);
});
test('최초 등록 경합 12건에서 정확히 하나 성공',async()=>{
  const rs=await Promise.all(Array.from({length:12},()=>register()));
  assert.equal(rs.filter(r=>r.body.ok).length,1,JSON.stringify(rs));
  assert.equal(sql(`select count(*) from roster_changes where kind='PIN 최초 등록'`),'1');
});
test('전화 없는 계정의 동시 등록은 한 요청의 번호와 PIN만 함께 보관한다',async()=>{
  const inputs=Array.from({length:12},(_,i)=>({memberId:ids.missing,name:'테스트미등록',phone:'010000000'+String(i).padStart(2,'0'),pin:'5829'+String(i).padStart(2,'0')}));
  const rs=await Promise.all(inputs.map(register));
  assert.equal(rs.filter(r=>r.body.ok).length,1,JSON.stringify(rs));
  const winner=inputs[rs.findIndex(r=>r.body.ok)];
  assert.equal(sql(`select phone from member_registration_contacts where nid='${ids.missing}'`),winner.phone);
  assert.equal((await login(ids.missing,'테스트미등록',winner.pin)).body.ok,true);
  assert.equal(sql("select count(*) from roster_changes where kind='PIN 최초 등록'"),'1');
});
test('선등록 신고는 기존 로그인과 등록 연락처를 무효화하고 최초 등록으로 돌아갈 수 없다',async()=>{
  const input={memberId:ids.missing,name:'테스트미등록',phone:'01000000007'};
  const old=await register(input);assert.equal(old.body.ok,true);
  const c=await issue(ids.missing,{reason:'선등록 신고'});assert.equal(c.body.ok,true,JSON.stringify(c));
  assert.equal((await api('pinStatus',{},old.body.token)).status,401);
  assert.ok((await register({...input,phone:'01000000008'})).body.needsRecovery);
  assert.equal(sql(`select invalidated_at is not null from member_registration_contacts where nid='${ids.missing}'`),'t');
  const r=await recover(c.body.recoveryCode,{memberId:ids.missing,name:'테스트미등록'});assert.equal(r.body.ok,true,JSON.stringify(r));
  assert.equal((await login(ids.missing,'테스트미등록','693857')).body.ok,true);
  assert.equal(sql(`select phone_verified_at is null and invalidated_at is not null from member_registration_contacts where nid='${ids.missing}'`),'t');
});
test('담당자 권한·본인 확인·현재 PIN 재확인이 모두 필요',async()=>{
  const m=await login();
  assert.ok((await api('resetPin',{targetId:ids.other,adminPin:PIN,reason:'PIN 분실',identityConfirmed:true},m.body.token)).body.error);
  for (const extra of [{identityConfirmed:false},{reason:'임의 사유'},{adminPin:'111111'}]) assert.ok((await issue(ids.member,extra)).body.error);
  assert.equal((await login()).body.ok,true);
});
test('담당자가 자기 입력 등록 번호를 확인하고 기존 복구 절차로 새 PIN을 발급한다',async()=>{
  const registered=await register({memberId:ids.missing,name:'테스트미등록',phone:'01000000007'});
  assert.equal(registered.body.ok,true);
  const admin=await login(ids.admin,'테스트교육');
  const r=await api('getPinRecoveryContact',{targetId:ids.missing},admin.body.token);
  assert.equal(r.body.ok,true);assert.equal(r.body.contacts[0].phone,'01000000007');assert.equal(r.body.contacts[0].source,'self_reported');assert.equal(r.body.contacts[0].disputed,false);
  assert.equal((await api('getPinRecoveryContact',{targetId:ids.missing})).status,401);
  assert.ok((await api('getPinRecoveryContact',{targetId:ids.missing},registered.body.token)).body.error);
  assert.equal(sql(`select phone_verified_at is null from member_registration_contacts where nid='${ids.missing}'`),'t');
  // 전화 통화 자체는 자동화하지 않는다. 확인 완료한 담당자의 발급·복구 경로를 검증한다.
  const code=await issue(ids.missing);assert.equal(code.body.ok,true);
  assert.equal((await recover(code.body.recoveryCode,{memberId:ids.missing,name:'테스트미등록'})).body.ok,true);
  assert.equal((await login(ids.missing,'테스트미등록','693857')).body.ok,true);
  const legacy=await api('getPinRecoveryContact',{targetId:ids.admin},admin.body.token);
  assert.equal(legacy.body.contacts[0].phone,'01000000002');assert.equal(legacy.body.contacts[0].source,'admin_roster');
});
test('선등록 신고된 연락처가 명단에도 있어도 중복·정상 번호로 표시하지 않는다',async()=>{
  await register({memberId:ids.missing,name:'테스트미등록',phone:'01000000007'});
  await issue(ids.missing,{reason:'선등록 신고'});
  sql(`insert into teacher_profiles(member_id,phone) values('${ids.missing}','010-0000-0007')`);
  const admin=await login(ids.admin,'테스트교육');
  const r=await api('getPinRecoveryContact',{targetId:ids.missing},admin.body.token);
  assert.equal(r.body.contacts.length,1);assert.equal(r.body.contacts[0].disputed,true);
});
test('복구 발급 즉시 기존 PIN·표 무효화, 이름/번호만 재등록 불가, 단회 완료',async()=>{
  const old=await login(), c=await issue();assert.equal(c.body.ok,true,JSON.stringify(c));
  assert.equal((await login()).body.needsRecovery,true);
  assert.equal((await api('pinStatus',{},old.body.token)).status,401);
  assert.ok((await register({memberId:ids.member,name:'테스트교사',phone:'01000000001'})).body.error);
  const r=await recover(c.body.recoveryCode);assert.equal(r.body.ok,true,JSON.stringify(r));
  assert.ok((await recover(c.body.recoveryCode)).body.error);
  assert.equal((await login(ids.member,'테스트교사','693857')).body.ok,true);
  assert.equal((await login()).body.token,undefined);
});
test('복구 코드 경합 12건에서 정확히 한 번 사용',async()=>{
  const c=await issue();assert.ok(c.body.recoveryCode,JSON.stringify(c));
  const rs=await Promise.all(Array.from({length:12},()=>recover(c.body.recoveryCode)));
  assert.equal(rs.filter(r=>r.body.ok).length,1,JSON.stringify(rs));
  assert.equal(sql("select count(*) from roster_changes where kind='PIN 복구 완료'"),'1');
});
test('복구 코드 만료·5회 실패·대상 바꾸기·재발급 전 코드 거절',async()=>{
  let c=await issue();assert.ok(c.body.ok,JSON.stringify(c));
  assert.ok((await recover(c.body.recoveryCode,{memberId:ids.other,name:'테스트대상'})).body.error);
  sql("update pin_recovery_challenges set expires_at=now()-interval '1 minute'");assert.ok((await recover(c.body.recoveryCode)).body.error);
  c=await issue();for(let i=0;i<5;i++)assert.ok((await recover('2222-2222-2222-2222')).body.error);
  assert.ok((await recover(c.body.recoveryCode)).body.error);
  const fresh=await issue();assert.ok((await recover(c.body.recoveryCode)).body.error);
  assert.equal((await recover(fresh.body.recoveryCode)).body.ok,true);
});
test('PIN 변경은 이전 표를 폐기하고 PIN 해제는 불가능',async()=>{
  const old=await login();
  const r=await api('setPin',{oldPin:PIN,pin:'693857'},old.body.token);assert.equal(r.body.ok,true,JSON.stringify(r));
  assert.equal((await api('pinStatus',{},old.body.token)).status,401);
  assert.ok((await api('removePin',{pin:'693857'},r.body.token)).body.error);
  assert.equal((await api('pinStatus',{},r.body.token)).body.hasPin,true);
});
test('실제 DB에서 PIN 실패 경합과 5회 잠금',async()=>{
  const rs=await Promise.all(Array.from({length:12},()=>login(ids.member,'테스트교사','111111')));
  assert.ok(rs.every(r=>!r.body.token));const fails=Number(sql(`select fails from member_pins where nid='${ids.member}'`));assert.ok(fails>=1 && fails<=5);
  for(let i=0;i<5;i++)await login(ids.member,'테스트교사','111111');
  assert.equal((await login()).body.locked,true);
});
test('감사 기록 실패 시 PIN 등록·복구 발급·코드 사용을 함께 취소',async()=>{
  const old=await login();
  sql("alter table roster_changes add constraint local_reject_audit check (kind not like 'PIN%')");
  try {
    assert.equal((await register()).status,503);
    assert.equal((await register({memberId:ids.missing,name:'테스트미등록',phone:'01000000007'})).status,503);
    assert.equal(sql(`select count(*) from member_pins where nid in ('${ids.fresh}','${ids.missing}')`),'0');
    assert.equal(sql('select count(*) from member_registration_contacts'),'0');
    assert.equal((await issue()).status,503);assert.equal((await api('pinStatus',{},old.body.token)).body.hasPin,true);
  }
  finally {sql('alter table roster_changes drop constraint local_reject_audit');}
  const c=await issue();
  sql("alter table roster_changes add constraint local_reject_audit check (kind <> 'PIN 복구 완료')");
  try {assert.equal((await recover(c.body.recoveryCode)).status,503);assert.equal(sql('select count(*) from pin_recovery_challenges where consumed_at is not null'),'0');}
  finally {sql('alter table roster_changes drop constraint local_reject_audit');}
  assert.equal((await recover(c.body.recoveryCode)).body.ok,true);
});
test('익명·일반 DB 역할로 인증 표와 복구 함수를 직접 이용할 수 없다',async()=>{
  for(const role of ['anon','authenticated']) {
    const headers={Authorization:'Bearer '+jwt(role),'content-type':'application/json'};
    for(const table of ['member_pins','pin_recovery_challenges','pin_enrollment_attempts','member_registration_contacts']) {
      const r=await fetch('http://127.0.0.1:58432/'+table+'?select=*',{headers});assert.ok([401,403].includes(r.status),role+'/'+table+':'+r.status);
      // RLS의 빈 응답만으로는 표 권한(특히 RLS가 보호하지 않는 TRUNCATE)을 차단한 것이 아니다.
      assert.equal(sql(`select has_table_privilege('${role}','public.${table}','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`),'f',role+'/'+table);
      assert.equal(sql(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`),'t',table);
    }
    const r=await fetch('http://127.0.0.1:58432/rpc/pin_account_action',{method:'POST',headers,body:JSON.stringify({p:{op:'register'}})});assert.ok([401,403].includes(r.status));
  }
  for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(sql(`select has_table_privilege('service_role','public.member_pins','${privilege}')`),'t',privilege);
});
test('기록에는 PIN·복구 코드·해시·로그인 표를 남기지 않는다',async()=>{
  const c=await issue();assert.equal(c.body.ok,true);assert.equal((await recover(c.body.recoveryCode)).body.ok,true);
  const log=sql('select row_to_json(r) from roster_changes r');
  for(const secret of [PIN,'693857',c.body.recoveryCode,'pin_hash','code_hash','token'])assert.ok(!log.includes(secret));
});

test('기존 4자리 PIN은 로그인에만 호환하고 새 등록·변경은 6자리',async()=>{
  const {scryptSync}=await import('node:crypto');
  const hash=scryptSync('5829','legacy-local-salt',32).toString('hex');
  sql(`update member_pins set salt='legacy-local-salt',pin_hash='${hash}' where nid='${ids.member}'`);
  const old=await login(ids.member,'테스트교사','5829');assert.equal(old.body.ok,true);
  assert.ok((await api('setPin',{oldPin:'5829',pin:'6938'},old.body.token)).body.error);
  assert.equal((await api('setPin',{oldPin:'5829',pin:'693857'},old.body.token)).body.ok,true);
});
