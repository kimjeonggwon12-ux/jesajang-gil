// action 이름 → 처리 함수. 묶음(파일)을 옮길 때마다 여기에 추가한다.
import roster from './actions/roster.js';
import activities from './actions/activities.js';
import targets from './actions/targets.js';
import tiers from './actions/tiers.js';
import chat from './actions/chat.js';
import courses from './actions/courses.js';
import education from './actions/education.js';
import feedback from './actions/feedback.js';

export const actions = {
  ...roster,
  ...activities,
  ...targets,
  ...tiers,
  ...chat,
  ...courses,
  ...education,
  ...feedback,
};
