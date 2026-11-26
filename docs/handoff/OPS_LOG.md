# 운영 DB 직접 변경 기록

운영 DB(Supabase 프로젝트 Teacher-squar)에 **코드 배포 없이 직접** 넣거나 고친 내용을 모두 적는다. 누가(어느 AI/사람), 언제, 어느 표의 어느 열쇠를, 왜, 어떻게 되돌리는지를 적는다.
실명·고유번호·연락처·PIN 값은 적지 않는다. 대상자는 DB 안에서 찾을 수 있는 열쇠(표·열·시각·kind)로만 가리킨다.

## 2026-11-26 (Claude, 운영자 요청)

| # | 시각(KST) | 표 | 내용 | 이유 | 되돌리기 |
|---|---|---|---|---|---|
| 1 | (오후, 정확한 시각 기록 없음) | `attend_records` | 목요 사명자 교육(`MT261126081123664`)에 교사 2명 출석 행 추가. `method='관리자처리'`, `at='2026-11-26 09:00:00'`, `late=''`, `record_id` = `AT26112609000000000xx` 형식 | 핀 장애로 QR 출석을 못 한 교사를 운영자가 출석 처리하라고 지시 | `delete from attend_records where meeting_id='MT261126081123664' and method='관리자처리'` |
| 2 | 15:09 | `member_pins`, `pin_enrollment_attempts`, `roster_changes` | 교사 1명 임시 PIN 발급(첫 등록 실패). 실패 기록 1행 삭제. `roster_changes` kind `PIN 임시 발급` 1행 | 직접 신고, 등록 실패 | 본인이 PIN 변경. 기록은 `roster_changes`에 남음 |
| 3 | 17:35 | `member_pins`, `roster_changes` | 같은 날 14:57에 임시 PIN을 받은 교사 1명에게 임시 PIN을 다시 발급. 사유 `임시 PIN 재발급` | 첫 임시 PIN을 전달받지 못함 | 위와 같음 |
| 4 | 20:40 | `member_pins`, `roster_changes` | 교사 1명 PIN 분실, 임시 PIN 발급. 사유 `직접 신고 - PIN 분실, 임시 PIN` | 직접 신고 | 위와 같음 |
| 5 | 22:0x | `edu_roster_policy` | **`roster_key='목요사명자'` 행 추가**. 값은 `월요모임` 행과 같음: `excluded_positions=[원장]`, `always_present_nids` 2명, `dept_overrides` 2명(협력교회). `source_note`에 사유 기록 | 이 행이 없어서 `eduFor()`가 "교육 집계 예외 설정이 준비되지 않았어요"로 throw → 10:20 오전 마감부터 방별 출석 전부 중단(아래 사고 기록) | `delete from edu_roster_policy where roster_key='목요사명자'`. **지우면 목요 집계가 다시 멈춤** |
| 6 | 23:0x | `report_rooms` | `dept='장년회#사명자'`, 방 '도마장년 사명자' 연결(`active=true`) | 운영자 요청: 장년회 전체 방과 같은 화요·목요 출석 묶음을 장년 사명자 방에도. **지금 코드로는 이 열쇠로 아무것도 안 감(발송 없이 확인)**. 코드 반영 대기(아래 요청 R3) | `update report_rooms set active=false where dept='장년회#사명자'` |

- 2~4의 `roster_changes.actor_name`은 운영자 계정 이름으로 남겼다(작업은 Claude가 함). 같은 날 14:57에 4명에게 나간 `PIN 임시 발급` 기록은 다른 작업자의 것이다.
- PIN 해시 방식은 운영 `server/actions/pins.js`와 같다(scrypt 32바이트, salt 16바이트 hex, `ver`=UUID). DB의 해시와 발급한 값이 맞는지 대조해서 확인했다.

## 앞으로 적는 방법

새 줄을 맨 아래 날짜 묶음에 추가한다. SQL 원문이 필요하면 값(개인정보)을 빼고 형태만 적는다.
