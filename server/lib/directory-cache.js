// 전 교사에게 같은 조회 범위를 제공하는 명단/리포트만 잠시 공유한다.
// 권한 판단이나 개인 활동 응답에는 쓰지 않는다. 명단 변경 시 즉시 무효화.
let entry;
export function invalidateDirectory() { entry = null; }
export function directorySnapshot(load, refresh = false) {
  if (refresh) invalidateDirectory();
  if (!entry || (entry.at != null && Date.now() - entry.at > 10_000)) {
    const current = { at: null, promise: null };
    current.promise = Promise.resolve().then(load).then(rows => { current.at = Date.now(); return rows; });
    entry = current;
    current.promise.catch(() => { if (entry === current) entry = null; });
  }
  return entry.promise;
}
