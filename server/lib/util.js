// 날짜 계산(달의 첫날·말일 등)은 모두 한국 시간 기준 — 서버가 어느 지역에서 돌든 같게 한다.
process.env.TZ = 'Asia/Seoul';

/** 고유번호 비교용: 숫자만 남기고 앞자리 0 제거. */
export function normId(raw) {
  const s = String(raw == null ? '' : raw).replace(/\D/g, '').replace(/^0+/, '');
  return s || '0';
}

export const str = (v) => String(v == null ? '' : v).trim();

const KST = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

/** 한국 시간 'yyyy-MM-dd'. */
export const kstDate = (d = new Date()) => KST.format(d).slice(0, 10);
/** 한국 시간 'yyyy-MM-dd HH:mm:ss'. */
export const kstDateTime = (d = new Date()) => KST.format(d);

/** DB 의 timestamp 값 → 'yyyy-MM-dd HH:mm:ss' (없으면 ''). */
export const fmtTs = (v) => (v ? String(v).slice(0, 19).replace('T', ' ') : '');

/** 시트 코드가 쓰던 내림차순 비교(같으면 0 — 먼저 적힌 것이 앞에 남는다). */
export const byDesc = (key) => (a, b) => (a[key] === b[key] ? 0 : (a[key] < b[key] ? 1 : -1));

/** 같은 사람인지: 적힌 그대로 같거나, 숫자만 남긴 값이 같으면 같은 사람(숫자가 없는 번호끼리는 그대로 비교). */
export function sameId(a, b) {
  const ra = str(a);
  const rb = str(b);
  if (!ra || !rb) return false;
  if (ra === rb) return true;
  const na = normId(ra);
  const nb = normId(rb);
  return na !== '0' && nb !== '0' && na === nb;
}

/** DB 의 timestamptz 값 → ISO 문자열(없으면 ''). 옛 서버가 날짜 칸을 그대로 내려주던 모양과 같다. */
export const isoTs = (v) => (v ? new Date(v).toISOString() : '');
