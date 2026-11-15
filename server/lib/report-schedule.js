// 예약 시각은 날짜와 한국 시간대를 함께 해석한다. 호스트 TZ·분 반올림에 의존하지 않는다.
export function reportInstant(date, time, delayMinutes = 0) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(time))) return NaN;
  const calendar = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== date) return NaN;
  return Date.parse(date + 'T' + time + '+09:00') + delayMinutes * 60000;
}
