// action 이름 → 처리 함수. 묶음(파일)을 옮길 때마다 여기에 추가한다.
import roster from './actions/roster.js';
import rosterAdmin from './actions/roster-admin.js';
import rosterImport from './actions/roster-import.js';
import backup from './actions/backup.js';
import activities from './actions/activities.js';
import targets from './actions/targets.js';
import tiers from './actions/tiers.js';
import chat from './actions/chat.js';
import courses from './actions/courses.js';
import education from './actions/education.js';
import feedback from './actions/feedback.js';
import plaza from './actions/plaza.js';
import calendar from './actions/calendar.js';
import connect from './actions/connect.js';
import videos from './actions/videos.js';
import transcripts from './actions/transcripts.js';
import attendance from './actions/attendance.js';
import attendanceClosing from './actions/attendance-closing.js';
import bot from './actions/bot.js';
import cohorts from './actions/cohorts.js';
import cohortBot from './actions/cohort-bot.js';

export const actions = {
  ...roster,
  ...rosterAdmin,
  ...rosterImport,
  ...backup,
  ...activities,
  ...targets,
  ...tiers,
  ...chat,
  ...courses,
  ...education,
  ...feedback,
  ...plaza,
  ...calendar,
  ...connect,
  ...videos,
  ...transcripts,
  ...attendance,
  ...attendanceClosing,
  ...bot,
  ...cohorts,
  ...cohortBot,
};
