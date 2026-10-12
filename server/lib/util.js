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
