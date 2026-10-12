// action 이름 → 처리 함수. 묶음(파일)을 옮길 때마다 여기에 추가한다.
import roster from './actions/roster.js';
import activities from './actions/activities.js';
import targets from './actions/targets.js';

export const actions = {
  ...roster,
  ...activities,
  ...targets,
};
