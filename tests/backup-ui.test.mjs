import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');
const start = html.indexOf('const rosterAdm = (() => {');
const end = html.indexOf('    // ═', html.indexOf('backup, backupStatus };', start));
const source = html.slice(start, end) + '\nthis.roster = rosterAdm;';
function screen(response) {
  const calls = [], messages = [], sheets = [];
  const context = { App: { memberId: '9900000000001', name: '가짜담당' }, callApi: async body => { calls.push(body); return response; },
    openSheet: value => sheets.push(value), toast: (...args) => messages.push(args), esc: value => String(value).replaceAll('<', '&lt;'), location: { href: '' } };
  vm.createContext(context); vm.runInContext(source, context);
  return { context, calls, messages, sheets };
}
test('기존 HTML의 전체 인라인 스크립트 문법을 유지한다', () => {
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (script[1].trim()) new vm.Script(script[1]);
});
test('기존 화면 상태 확인은 읽기 API만 호출하고 실패·성공 시각·미검증을 구분한다', async () => {
  for (const [state, expected] of [['healthy', '정상'], ['failed', '최근 백업 실패'], ['unverified', '완료 확인 필요'], ['interrupted', '완료 응답 없음']]) {
    const f = screen({ rows: [], health: { state, lastSuccessAt: state === 'unverified' ? null : '2026-11-15T03:00:00Z' } }), button = { disabled: false };
    await f.context.roster.backupStatus(button);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].action, 'getBackups'); assert.equal(button.disabled, false);
    assert.ok(f.sheets[0].includes(expected)); assert.ok(f.sheets[0].includes(state === 'unverified' ? '아직 없음' : '12:00:00'));
    assert.equal(f.context.location.href, '');
  }
});
test('조회 오류는 정상 상태를 표시하지 않고 버튼을 되돌린다', async () => {
  const f = screen({ error: '백업 조회 실패' }), button = { disabled: false };
  await f.context.roster.backupStatus(button);
  assert.equal(f.sheets.length, 0); assert.equal(f.messages[0][0], '백업 조회 실패'); assert.equal(button.disabled, false);
});
