# 교육 관리 — 화요전도단·목요사명자교육 (계약 제안, 2026-11-16)

`EDUCATION.md`의 요청을 구현한 기능의 API·저장·권한 계약이다. 운영 적용 전 전환 담당 검토와 아래 "담당자 확인" 결정이 필요하다.

## 진입과 기본 꺼짐

- (11/16 사용자 지시로 변경) A·B 모두 관리자 **'출석' 바로 옆 '교육보고' 탭**. A `data-subtab="eduReport"`, B `/admin/edu-report`(`ClassicAdminFrame` 탭·`shared/pilot-paths.mjs`에 추가). 탭은 서버 `eduMgmtAccess`가 켜짐·권한을 알려 줄 때만 보인다. 교육 관리(과정) 화면은 원래대로.
- 서버 환경값 `EDU_MGMT_ENABLED=1`일 때만 동작한다. 없으면 `eduMgmtAccess`는 `{enabled:false}`만 돌려주고(DB 조회 없음) 나머지 새 액션은 모두 503이다. 화면 전환 단추도 숨는다.
- 새 예약·봇·웹훅·Telegram 발송은 없다. 공무 저장은 기존 보고가 읽는 원본에 반영될 뿐 보고를 다시 보내지 않는다.
- 기능 중지 = 환경값 제거(재배포 필요). 전체 A 복귀와 별개이며, 중지해도 저장된 공무·상세·이력은 DB에 남고 기존 보고·전체 공무 화면이 그대로 읽는다.

## 액션

| 액션 | 권한 | 내용 |
|---|---|---|
| `eduMgmtAccess` | 로그인 | `{enabled, owner, manager, heads[], visible}` |
| `getEduWeekly {date}` | manager: 그 모임 출석·자료 위임 / head: 자기 소속 줄만 | 그 주(월~일) 화전단·목사교 모임별 조직 요약 + 총계 |
| `getEduWeeklyDetail {date, meetingId, group}` | 같음 | 하위 줄(24부서→소속, 자문·장년·부녀·청년→지역) + 사람별 상태 |
| `exportEduWeekly {date}` | 같음 | 요약 CSV(숫자만, 이름 없음). A·B 같은 서버 결과를 내려받음 |
| `getEduExcusedScope {kind, date, affiliation?}` | head: 자기 소속 / manager: 전체 소속 | 소속 사람·공무 여부·출처·사유·교육 방법/결과·버전·이력 |
| `applyEduExcusedScope {kind, date, affiliation, revision, changes[]}` | 같음 | `changes: [{memberId, op:'register'|'cancel', reason, followMethod?}]` |
| `saveEduExcusedFollowup {kind, date, affiliation, memberId, version, followMethod, followResult, followDone}` | 같음 | 추후 교육 방법·결과만 저장 |
| `listEduDeptHeads`, `setEduDeptHead {op, memberId, affiliation}` | 앱 책임자만 | 24부서 소속별 부서장 지정·회수 |

- 사람 식별은 재적의 정규화 고유번호(`memberId` = `edu_roster.nid`), 회차는 `meetingId`. 이름은 표시용.
- manager 판단은 기존 `educationGrants`/`permits` 그대로(전체 공무 범위는 기존 `edu_excused_state.scopes` 모두의 출석 위임 — 기존 전체 화면과 같은 기준). head는 새 표 `edu_dept_heads`의 지정. 화면에서 보낸 소속은 권한 근거가 아니다.

## 계산(기존 기준 보존)

`server/lib/edu-weekly.js`. 재적·출석은 기존 `eduPeople`(= `edu-attendance.js`의 prepare: 오전·저녁 중복 1명, 항상 출석, 제외 직책)을 그대로 쓴다.

- 참석 = 어느 타임이든 출석. 지각은 참석의 일부 → 정시 = 참석 − 지각.
- 실제 참석이 공무보다 우선. 공무 = 미참석이면서 `#excused`. 불참 = 재적 − 참석 − 공무.
- 참석률 = 참석 ÷ 재적(공무 포함). 네 칸(정시·지각·공무·불참)의 합 = 재적.
- 분모: 정기교육에 `roster_key`가 있으면 그 교육 재적(기존 카드의 조직 순서). 없으면(현재 화요전도단) 기존 중진 보고와 같은 24부서 재적이며, 화면에 "대상 재적 확인 필요"로 표시한다.

## 저장 계약(제안 SQL: `supabase/proposals/20261116120000_edu_mgmt_scoped_excused.sql`)

- 공무 원본은 그대로 `cohort_summary_log('#excused', kind, ref_id, date)` 한 곳이다. 새 함수 `edu_mgmt_scope_apply`는 **한 소속 사람의 줄만** 넣고 지운다. 기존 `edu_excused_apply`(전체 교체)는 바꾸지 않았다.
- 소속 revision(`edu_mgmt_scope_state`)은 그 소속의 사람·선택·상세와 접근 정보만 담는다. 다른 부서 저장은 서로를 막지 않고, 같은 소속의 오래된 화면은 409다. 기존 전체 화면 revision은 전체 선택을 담으므로 부서 저장 뒤 오래된 전체 저장은 409다(기존 동작).
- 개인별 사유·교육 방법/결과는 `edu_excused_details`(같은 트랜잭션). 원본에 없는 상세(전체 화면에서 해제됨)는 "해제됨"으로 보이고 공무로 세지 않는다.
- 모든 변경은 `edu_excused_detail_log`(실행자·역할·전후)에 남는다. 원본이 바뀐 저장은 기존 `edu_excused_changes`에도 전후 전체 명단을 남긴다.
- 잠금은 기존 `edu_excused_apply`와 같은 표 순서 + 새 표 순서다. 부서장 지정은 트랜잭션 안에서 다시 확인한다(회수 경합 방지).
- 교육 결과 저장은 출석·공무 원본·보낸 보고를 바꾸지 않는다.
- 되돌리기: 새 함수만 drop하면 기존 기능은 그대로다. 상세·이력 보존이 필요하면 표는 남긴다.

## 검증 환경

- 공유 검사(`npm run test:handoff`)에 `edu-mgmt.test.mjs`(가짜 DB 주간 계산·권한·CSV·꺼짐)와 `edu-mgmt-ui.test.mjs`(A `EM-VIEW` 블록 ↔ B `next-app/lib/edu-mgmt.ts` 일치, 진입 숨김, 메뉴 불변)를 추가했다.
- 실제 PostgreSQL 검사: `tests/local-edu-mgmt-pg.test.mjs`. 대상은 로컬 합성 DB만 받는다(`127.0.0.1`/`localhost`, DB 이름에 `synth`). 실행할 때마다 public 스키마를 지우고 기존 마이그레이션 전부와 제안 SQL을 적용한다.
  ```sh
  # 예: 로컬 전용 Postgres 17 (127.0.0.1:55440, DB edu_mgmt_synth, 외부 전송 없음)
  EDU_MGMT_TEST_DB_URL=postgres://postgres:<local>@127.0.0.1:55440/edu_mgmt_synth \
  EDU_MGMT_PG_MODULE=<pg 패키지 index.js의 file URL; 저장소 의존성에 넣지 않음> \
  node --experimental-test-module-mocks --test tests/local-edu-mgmt-pg.test.mjs
  ```

## 운영(A) 반영 — 2026-11-16 사용자 지시

- 운영 `vercel-supabase`에 같은 화면·계약으로 배포했다(운영 커밋 `3439b33`). 운영 DB에 제안 SQL을 적용했고(Supabase SQL 편집기, 내용 해시 일치 확인), `EDU_MGMT_ENABLED=1`을 설정했다.
- 운영 서버는 아직 강화 인증·교육 위임 모듈이 없어 두 가지가 다르다.
  - 신원: `api/index.js`가 입장 표로 확인한 번호를 `_actorNid`로 넘긴다.
  - 전체 관리 권한: 앱 책임자 + 교육·전도 담당(`isApprover`)이다. 기존 도우미연결 공무 체크와 같은 기준이다.
  - B 전환 때는 이 PR의 위임 기준(`educationGrants`)으로 바뀐다. 전환 측에 기준 확인을 요청한다.

## 공무 본인 신고 (2026-11-16 사용자 지시, 운영 반영)

- 이유: 부서 재적이 맞지 않고, 등록된 사람을 매번 바꿔 주기 어렵다. 그래서 본인이 직접 올린다.
- 대상(11/16 3차): 목사교 재적(교자장부청 부구역장 이상 사명자) 전원, 24부서 포함. 원장은 집계 제외라 카드도 숨긴다.
  - 데이터 정정: 이경옥 원장 재적 직책 '센터전도사' → '원장'. 엑셀 원본도 고쳐야 다음 재적 반영 때 되돌아가지 않는다.
- 비교사(교사 명단에 없는 재적 102명)는 로그인할 수 없다. 대책은 사용자 결정 대기다(손님 입장을 사명자 재적 대조로 넓히는 안).
- 위치(11/16 2차 지시): 나의 교실 '내 활동 보고 · 피드백방' 옆 **'출석'** 칸. 제목은 "화요 전도단 · 목요 사명자 교육 공무 보고"다.
  - A: `ACT_PAGES` attend / `excusedSelfPageHtml`. B: `/activities?view=attend`(`ClassroomHeader` 세 번째 칸). B의 `/attendance`(내 출석 기록)는 그대로 둔다.
- 교육별로 다가오는 날짜 2개(화요전도단 = 화요일, 목요 사명자 교육 = 정기 교육 요일) 옆 [공무로 신고]를 누른다. 사유는 선택(비우면 '공무'), 취소할 수 있다.
- 화요전도단의 교육보고 집계 기준이 아직 24부서 재적이라, 교역자·자문·장년·부녀·청년의 화요전도단 본인 신고는 기록만 되고 집계에는 나오지 않는다. 화요전도단 대상 재적이 정해지면 반영한다(확인 필요).
- 신원은 세션, 소속(부서·지역)은 교육 재적(`edu_roster` 목요사명자)에서 서버가 채운다. 화면에서 보낸 번호·소속은 쓰지 않는다.
- 액션: `getMyExcused`, `submitMyExcused {date, reason?}`, `cancelMyExcused {date}`(`server/actions/edu-excused-self.js`). 같은 `EDU_MGMT_ENABLED` 스위치를 쓴다.
- 저장: 별도 표 `edu_excused_self`(`supabase/proposals/20261116180000_edu_excused_self.sql`). 관리자 '#excused' 전체 교체 저장이 본인 신고를 지우지 않게 하기 위해서다. 취소는 `active=false`로 기록을 보존한다.
- 집계: 교육보고 탭 = '#excused' ∪ 본인 신고(유효). 실제 참석이 우선이다. 상세에는 '본인 신고: 사유'가 붙는다.
  - 기존 Telegram 교육 보고 카드(목사교 방·중진 방)에는 아직 본인 신고가 반영되지 않는다(확인 필요).
- 남은 것: 로그인하지 않은 사람용 '고유번호·부서·지역 직접 입력' 신고. 공개 입력이라 사칭을 막을 방법(예: QR 출석처럼 이름 일치)을 정한 뒤 구현한다.

## 교육보고 탭 재구성 (2026-11-16 4차, 사용자 지시)

- 탭 구성: **주간 출석 현황 | 공무자 관리**.
  - 본인 신고로 바뀌어 '공무 사전보고(부서별)'와 '부서장 지정' 화면은 뺐다. 해당 서버 액션·표(`edu_mgmt_scope_*`, `edu_dept_heads`)는 남아 있지만 화면에서 쓰지 않는다. 정리 여부는 전환 측과 결정한다.
- 공무자 관리:
  - 교육 테마 단추(🔥 화요 전도단 / 📖 목요 사명자 교육)와 날짜를 고르면, 그날 공무자 전부(본인 신고 + 관리자 대신 등록 + 도우미연결 명단)가 출처·사유·그날 실제 출석 여부와 함께 나온다.
  - 대신 등록: 이름으로 찾아 사유 기록과 함께 등록한다. 등록자가 기록되고, 원장은 빠진다.
  - 공무 해제: 두 번 눌러 확인한다. 본인 신고는 `active=false` + 해제자를 남기고, 도우미연결 명단은 그 한 줄만 지운다.
  - 액션: `getExcusedList`, `searchEduRosterForExcused`, `adminSetExcused`, `adminCancelExcused`. 권한은 교육 manager(운영 A: 책임자·교육·전도 담당, B: 위임)다.
- 출석 칸 카드도 두 교육을 큰 색 블록(주황·파랑)으로 나눴다.
- 표 칸 추가: `edu_excused_self.registered_by`, `canceled_by`(제안 SQL에 포함, 운영 적용함).

## 11/16 5차 — 공무자 명단 바로 보기·교자장부청, 문구

- 교육보고 탭을 열면 **공무자 관리가 먼저** 나온다. 날짜는 그 교육의 가장 가까운 날(화요전도단 = 화요일, 목요 사명자 교육 = 목요일)로 미리 잡혀 명단이 바로 뜨고, 날짜·교육을 바꾸면 곧바로 다시 불러온다.
- 명단은 교·자·장·부·청(교역자 / 장로·자문회 / 장년회 / 부녀회 / 청년회) + 24부서로 묶는다. 묶음 단추로 한 조직만 볼 수 있다(`exlGroups`, `emNextDate` A·B 공용).
- 문구:
  - 나의 교실 서브 탭 '공무 결석 보고'
  - 카드 제목 '화요 전도단 · 목요 사명자 교육 공무로 인한 결석자 보고'
  - 버튼 '공무 결석으로 신고'
  - 입력 '결석 사유 기록'(관리자 대신 등록 칸도 같음)

## 담당자 확인 (임의 확정하지 않음)

1. 부서장 = 24부서 소속(`affiliation`)별 지정 방식으로 구현했다(앱 책임자가 지정). 직책 자동 인정, 겸직, 지역장 등 다른 조직의 부서장 범위가 필요한지.
2. 관리자가 아닌 부서장의 진입 위치. 현재 A·B 모두 관리자 섹션 안에 있어 `isAdmin`이 아니면 화면에 들어올 수 없다. 서버 권한은 준비되어 있다. 메뉴·A/B 경로 변경이라 전환 담당과 조율이 필요하다.
3. 화요전도단 대상 재적(현재 24부서 재적으로 표시)과 주간 회차 기준(한 주에 여러 모임이면 모임별 카드).
4. 부서장 보고를 즉시 공무로 확정할지, 별도 확인 단계를 둘지. 현재는 즉시 반영이다.
5. 사전보고 마감과 사후 수정·취소 허용 시점, 교육 결과 입력·확정 담당. 현재는 제한이 없고 시각·실행자만 기록한다.
6. `교자장어부청` 표시 순서와 교회/신학·24부서 중복 분류. 현재는 기존 카드 순서와 재적 `dept` 하나를 따른다.
7. 참석률 분모 변경 요구 여부. 현재는 기존 계산을 유지한다.
