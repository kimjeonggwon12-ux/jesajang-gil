# Codex · Claude 공동 작업 체계 제안 (2026-11-26, Claude 작성 / 운영자·Codex 검토용)

## 지금 상태 (확인한 사실)
- 공동 문서는 `docs/handoff/`(기준 브랜치 `codex/ab-education-baseline-20261116`)에 있다. 변경 전달은 `CHANGE_TEMPLATE.md` 양식으로, 기준 브랜치를 대상으로 PR을 보낸다(PR #1·#2, 11/16).
- **운영 배포본이 GitHub에 없다.**
  - 운영 `jesajang-gil`은 11/24~26에 guh98 계정이 CLI로 여러 번 배포했다(최신 `dpl_BVX6a4WzX3ZFz37HdTFyz6YuEoHK`, 11/26 12:45).
  - 원격 브랜치의 마지막 커밋은 11/16(기준)·11/24(feature)이고 `main`은 11/15다.
  - 그래서 다른 작업자는 "최신 main 확인"을 할 수 없다. 로컬 코드로 배포하면 운영 기능(PIN 재등록, edu_roster_policy 등)을 덮어쓰게 된다.
- 작업 선점 표나 운영 DB 직접 변경 기록이 없다. 11/26에 같은 날 임시 PIN 발급을 두 작업자가 따로 했다.

## 제안
1. **운영 = Git 한 곳.** 배포는 반드시 GitHub에 푸시된 커밋에서 한다. 예: `ops/production` 브랜치(또는 배포마다 `deploy-YYYYMMDD-HHMM` 태그). Codex가 지금 운영 배포본을 먼저 그 브랜치에 올린다.
2. **배포 기록:** 배포할 때마다 `docs/handoff/DEPLOYS.md`에 한 줄을 남긴다(시각, 커밋, Vercel 배포 ID, 작업자, 내용).
   - 배포 직전에 "지금 운영 배포 ID = 표의 마지막 줄"인지 확인한다. 다르면 멈추고 묻는다(동시 배포 방지).
3. **작업 선점:** `WORKBOARD.md`에 줄을 추가하고 푸시한 뒤에 시작한다. 수정 파일이 겹치면 시작 전에 운영자와 상대 AI에게 알린다.
4. **운영 DB 직접 변경:** `OPS_LOG.md`에 반드시 남긴다(되돌리는 방법 포함). 구조 변경은 `supabase/migrations/`에 원문을 남긴다.
5. **브랜치 이름:** `codex/…`, `claude/…`. PR 대상은 `ops/production`(또는 운영자가 정한 통합 브랜치). 서로의 미완료 브랜치는 고치지 않는다.
6. **인계:** 기능 단위로 `CHANGE_TEMPLATE.md`를 채운다. 사고는 `INCIDENT_YYYYMMDD_*.md`(원인·실제 영향·조치·남은 일).
7. **비밀·개인정보:** 지금 규칙(AGENTS.md)을 그대로 따른다. 이름·고유번호·PIN·연락처는 문서와 커밋에 넣지 않는다.

## 운영자가 정할 것
- 통합·배포 브랜치 이름(`ops/production` 제안)과, 운영 배포 권한을 Claude에도 줄지 여부(Codex와 순서 규칙 포함).
- Codex의 현재 운영 소스를 언제 GitHub에 올릴지.
