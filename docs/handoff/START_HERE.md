# 먼저 읽기 — HTML/Next.js 교육 공동 개발

기준일: 2026-11-16 (한국 시간). 이 문서는 다음 개발자/Claude가 별도 대화 기록 없이 시작할 수 있는 공개용 인계 문서다.

## 1. 확정된 협업 방식

전환 측이 현재 코드를 공유하고, 원 개발 측은 같은 기준에서 **HTML(A) 화면과 Next.js(B) 화면을 모두 개발·검증**한다. 공통 서버의 권한·계산·저장은 한 번만 구현한다. 완료한 변경분을 전환 측이 받아 통합·교차검증한다. 운영 적용은 사용자와 별도 검토한다.

- 기준 브랜치: `codex/ab-education-baseline-20261116`
- 운영/기존 브랜치: `main`, `vercel-supabase` — 직접 push/merge 금지
- 기능 브랜치 예: `feature/education-management`
- PR 대상: **기준 브랜치**. 기본으로 제시되는 `main`을 그대로 선택하지 않는다.
- 원 개발 측은 교육 기능의 화면·서버 처리·테스트·DB 변경 제안까지 맡을 수 있다. 공통 인증/권한 기반·분기·배포는 전환 측이 관리한다.
- 신규 기능은 기본 비활성으로 준비하고 화면뿐 아니라 새 쓰기/예약 처리도 제어한다. 공개 시점은 별도 결정한다.

## 2. 소스 기준과 배포 상태를 구분하기

공유본은 로컬 작업의 원래 Git 기준 `4b8233f3647ad1bc8c8891f7b4191c8f32a4f22f` 위에 누적 개선을 정리한 것이다. 옛 HEAD만 체크아웃하면 개선 코드가 없다. 이 공유 브랜치의 최신 커밋을 받는다.

검토 배포 후보의 제품 파일 427개와 비교하여 최신 로컬 비공개 R2 키 분리 수정도 포함했다. 다만 공유 과정에서 다음 차이를 추가했다.

- 실제 책임자 고유번호 기본값을 제거하고 서버 환경변수만 사용한다. 미설정이면 책임자 권한을 부여하지 않는다. 실제 적용 전 책임자 설정과 세션/명단을 반드시 검증한다.
- 공유 브랜치의 루트와 Next.js 배포 설정에 자동 Git 배포 차단을 추가했다. 운영 프로젝트 설정이나 기존 브랜치를 변경한 것은 아니다.
- 공개용 지침, 검증 명령, 비밀/생성물 제외 규칙을 추가했다.

파일 기준은 `source-baseline.json`, 이번 검증은 `VALIDATION.md`를 본다. 원격의 기존 교육 업데이트는 이전 전환 과정에서 선별 이관했다. 원격 브랜치를 통째로 덮어쓰거나 기존 커밋을 다시 무조건 적용하지 않는다. Git 이력의 조상 관계만으로 기능의 포함 여부를 판단하지 않는다.

현재 보안·성능 개선 및 A/B 분기는 개발/검토 후보에 있으며 **운영 A/B 시작은 아직 아니다**. DB에는 이전에 승인된 구조 변경이 이미 적용되었으므로 기존 SQL 재실행 금지다. 비공개 R2 실연동, 내보내기 설정, 일부 UI 동선 및 실제 휴대전화 PWA 검증 등 전환 잔여 항목을 신규 교육 기능 완료와 혼동하지 않는다.

## 3. 코드 지도

| 영역 | 위치 |
|---|---|
| A 화면 | 루트 `app.html` 및 기존 업무 HTML |
| B 화면 | `next-app/app/(member)/`, `next-app/components/` |
| 공통 API 진입 | `api/index.js`, `server/registry.js` |
| B에서 같은 API 연결 | `next-app/app/api/route.ts` |
| 업무 처리/인증 | `server/actions/`, `server/lib/` |
| A/B 화면 분기 | `shared/pilot-paths.mjs`, `server/lib/pilot*.js`, `next-app/proxy.ts` |
| A/B 공통 표시 계산 | `shared/`, `next-app/lib/`의 기존 HTML 대조 함수 |
| 기존 DB 구조/변경 이력 | `supabase/migrations/` (자동 적용 금지) |
| 정적 공개 파일 생성 | `tools/prepare-next-legacy.mjs` |
| 기능 비교/권한 검사 | `tests/` |

A/B 운영은 같은 DB/API를 쓰는 계정별 화면 선택이다. 전체 A 복귀는 같은 강화 API/DB를 유지하며 HTML로 돌아가는 것으로, DB 복원이나 옛 서버 재배포가 아니다. 공통 신규 기능의 장애는 전체 A 복귀만으로 해결되지 않으므로 별도 기능 중지 방안을 마련한다.

## 4. 가져오기와 첫 검증

Node.js **24.x**, npm, Git을 준비한다. 기존 원격 이력과 대조하는 검사가 있으므로 shallow/single-branch clone을 피한다.

```sh
git clone https://github.com/kimjeonggwon12-ux/jesajang-gil.git
cd jesajang-gil
git switch codex/ab-education-baseline-20261116
git switch -c feature/education-management
npm ci --ignore-scripts --no-audit --no-fund
npm --prefix next-app ci --ignore-scripts --no-audit --no-fund
npm run check:handoff
npm run build:handoff
npm run test:handoff
```

이 검증 묶음은 운영 DB/API·Telegram·R2 연결 없이 소스·가짜 응답·HTML/React 계산·로컬 빌드를 확인한다. 실제 브라우저 저장이나 실물 PWA 검증을 대신하지 않는다. 자세한 실행 결과와 제외 항목은 `VALIDATION.md`를 본다.

## 5. 개발용 데이터와 실행 환경

이 저장소에 운영 환경 파일·DB 덤프·비밀키·전환 담당자의 기존 시험 런타임 파일은 없다. `npm run dev/start`와 `test:*:db`, 일부 `tools/local-*`는 이전 Mac의 고정 로컬 포트/가짜 DB를 전제로 한다. 새 컴퓨터에서 곧바로 동작하는 범용 설치 도구가 아니다.

화면 개발은 가짜 API 응답부터 진행할 수 있다. 실제 저장 교차검증은 **새로 격리한 합성 DB**에 A와 B를 함께 연결해 진행한다. 기존 시험 DB를 초기화하거나 운영 키로 실패를 우회하지 않는다. 운영과 같은 DB를 사용하는 최종 A/B 시범 원칙과 개발용 합성 검증을 구분한다. 새 환경을 준비하면 포트·DB 이름·시드 범위·외부 전송 차단과 실행법을 기능 문서에 기록한다.

필요한 서버 설정 이름은 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_SIGNING_KEY`, `TEACHERSQUARE_SYSTEM_OWNER_ID`, `PILOT_ROUTING_ENABLED` 등이다. 이 목록은 운영 값을 요구하는 지시가 아니다. 로컬에서는 가짜 값과 로컬 주소만 사용한다. `PILOT_ROUTING_ENABLED=1`은 A/B 빌드와 실행 양쪽에 필요하다.

비공개 첨부는 `R2_PRIVATE_BUCKET`, `R2_PRIVATE_ACCESS_KEY_ID`, `R2_PRIVATE_SECRET_ACCESS_KEY`, 선택 `R2_PRIVATE_ACCOUNT_ID`를 사용한다. 기존 공개 키로 우회하지 않는다. 실제 비밀값과 수신처는 공동 개발용 Git으로 전달하지 않는다.

## 6. 개발/전달 순서

1. `EDUCATION.md`의 기존 기능과 미확정 업무 기준을 읽는다.
2. 교육·회차·부서·안정적인 대상자 ID·버전 충돌을 포함한 API 입력/출력 계약을 먼저 제안한다.
3. 화면 골격 → 주간 현황/부서 상세 → 공무 등록/수정/취소 → 교육 방법/결과 순으로 작은 변경 묶음을 만든다.
4. A/B 화면 각각의 결과, 공통 서버, 권한 거절, 두 부서 동시 저장을 검증한다. 실제 운영 기록과 보고방은 사용하지 않는다.
5. `CHANGE_TEMPLATE.md`를 채워 기능 PR로 전달한다. DB 변경은 SQL 제안과 호환/복구 설명까지만 포함한다.
6. 전환 측이 기존 기능·A/B 이동·전체 A 복귀·DB 호환성을 확인한다. 운영 공개·배포는 사용자 승인 후 별도 진행한다.
