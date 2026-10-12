// 교사광장 봇으로 가는 알림 연결점.
// 봇 묶음(TeacherSquareBot)을 옮기면 여기서 실제 발송 함수를 부른다 — 그 전까지는 아무 일도 하지 않는다.

/** 저장 action 이 끝난 뒤(옛 _tsAfter_). result 를 그대로 돌려준다. */
export async function afterAction(action, body, result) {
  return result;
}

/** 전도 대상자가 새 단계에 도달했을 때(옛 _tsOnStageReached_). */
export async function onStageReached(memberId, targetId, fromStage, toStage) {}
