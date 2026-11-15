# 교사광장 A/B 공동 개발 기준

**Claude와 다른 개발 AI는 [시작 문서](docs/handoff/START_HERE.md)와 [작업 지침](AGENTS.md)을 먼저 읽으세요.**

이 브랜치는 기존 HTML(A), Next.js(B), 공통 서버를 함께 개발하기 위한 기준 소스입니다. 운영 배포본이 아니며 push로 운영을 전환하지 않습니다.

- 기준 브랜치: `codex/ab-education-baseline-20261116`
- 새 기능: 이 기준에서 `feature/education-management` 등 별도 브랜치를 생성
- 개발 범위: A용 HTML 화면 + B용 Next.js 화면 + 공통 API 한 벌
- 전달: 기능 브랜치의 변경분과 검증 결과를 PR로 제출. PR 대상은 이 기준 브랜치
- 운영 DB 변경·배포·A/B 배정·실제 Telegram 전송은 별도 승인 대상

## 먼저 볼 문서

1. [현재 상태·기준 소스·실행 방법](docs/handoff/START_HERE.md)
2. [교육 기능 요구사항과 기존 구현](docs/handoff/EDUCATION.md)
3. [권한과 공통 기반의 변경 경계](docs/handoff/BOUNDARIES.md)
4. [이번 공유 검증 결과와 남은 확인](docs/handoff/VALIDATION.md)
5. [변경 전달 양식](docs/handoff/CHANGE_TEMPLATE.md)

Node.js 24.x가 필요합니다. DB 없이 실행 가능한 설치·검증 명령은 시작 문서에 있습니다. 기존 `dev`와 `test:*:db`는 전환 담당자의 전용 로컬 환경을 전제로 하므로 처음 받은 환경에서 바로 실행하지 마세요.
