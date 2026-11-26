# 작업 현황판 (Codex · Claude · 운영자 공용)

> **규칙:** 작업을 시작하기 전에 이 표에 줄을 추가해서 **커밋·푸시**한다(= 선점). 끝나면 상태와 커밋·배포 ID를 채운다.
> 다른 줄과 **수정 파일이 겹치면** 시작하지 말고 운영자에게 먼저 알린다.
> 개인정보·비밀값은 적지 않는다. 운영 DB 직접 변경은 `OPS_LOG.md`에 따로 적는다.

| ID | 담당 | 작업 | 수정 범위(파일·표) | 브랜치 | 상태 | 커밋 / 배포 ID | 비고 |
|---|---|---|---|---|---|---|---|
| W-001 | Codex | 출석 집계 장애 코드 수정·구조 개선(오류 문구 기록, 반복 실패 알림, policy 검증) | `server/actions/attendance.js`, `server/lib/edu-attendance.js`, `room-attendance.js`, `report-delivery-batch.js`, `edu-delivery.js` | (Codex 기입) | 진행 중 | | INCIDENT_20261126 R4 |
| W-002 | Codex(제안: Claude) | 목사교 교역자 방 = 카드+명단(R1), 청년회 기타 나누기(R2), 장년회#사명자 방(R3) | 위와 같은 파일, `report-room.js` | | 대기 | | W-001과 파일이 겹쳐 Codex가 함께 처리 |
| W-003 | Claude | 11/26 운영 DB 조치 기록·발송 검증·규칙 대조 문서 | `docs/handoff/*` | `claude/ops-record-20261126` | 완료 | (이 커밋) | 코드 변경 없음 |

## 상태 값
`대기` → `진행 중` → `검토` → `배포` → `완료` / `보류`
