// action 이름 → 처리 함수. 묶음(파일)을 옮길 때마다 여기에 추가한다.
import directory from './actions/directory.js';
import pilot from './lib/pilot.js';
import deliveryReview from './actions/delivery-review.js';
import roster from './actions/roster.js';
import centerPolicy from './lib/center-policy.js';
import rosterAdmin from './actions/roster-admin.js';
import rosterImport from './actions/roster-import.js';
import backup from './actions/backup.js';
import activities from './actions/activities.js';
import targets from './actions/targets.js';
import tiers from './actions/tiers.js';
import teacherExport from './actions/teacher-export.js';
import chat from './actions/chat.js';
import courses from './actions/courses.js';
import education from './actions/education.js';
import feedback from './actions/feedback.js';
import plaza from './actions/plaza.js';
import calendar from './actions/calendar.js';
import connect from './actions/connect.js';
import videos from './actions/videos.js';
import lectures from './actions/lectures.js';
import visits from './actions/visits.js';
import transcripts from './actions/transcripts.js';
import attendance from './actions/attendance.js';
import attendanceClosing from './actions/attendance-closing.js';
import bot from './actions/bot.js';
import cohorts from './actions/cohorts.js';
import cohortBot from './actions/cohort-bot.js';
import cohortSchedule from './actions/cohort-schedule.js';
import pins from './actions/pins.js';
import centerSend from './actions/center-send.js';
import newMarks from './actions/new-marks.js';
import homeNotices from './actions/home-notices.js';
import targetRoom from './actions/target-room.js';
import auth from './actions/auth.js';
import educationAccess from './actions/education-access.js';
import eduAtt from './lib/edu-attendance.js';
import eduReports from './actions/edu-reports.js';
import eduRosterAdmin from './actions/edu-roster-admin.js';
import wordsquareVideos from './lib/wordsquare-videos.js';   // 11/22 말씀광장 새 영상 → 교사광장 영상(월요일 자동)
import eduExcused from './actions/edu-excused.js';
import eduMgmt from './actions/edu-mgmt.js';
import eduExcusedSelf from './actions/edu-excused-self.js';   // 11/16 공무 본인 신고   // 2026-11-16 교육 관리(화전단·목사교) — 기본 꺼짐 EDU_MGMT_ENABLED

export const actions = {
  ...pilot,
  ...roster,
  ...centerPolicy,
  ...directory,
  ...rosterAdmin,
  ...rosterImport,
  ...backup,
  ...activities,
  ...targets,
  ...tiers,
  ...teacherExport,
  ...chat,
  ...courses,
  ...education,
  ...feedback,
  ...plaza,
  ...calendar,
  ...connect,
  ...videos,
  ...lectures,
  ...visits,
  ...transcripts,
  ...attendance,
  ...attendanceClosing,
  ...bot,
  ...cohorts,
  ...cohortBot,
  ...cohortSchedule,
  ...pins,
  ...centerSend,
  ...newMarks,
  ...homeNotices,
  ...targetRoom,
  ...auth,
  ...educationAccess,
  ...wordsquareVideos,
  ...eduAtt,
  ...eduReports,
  ...eduRosterAdmin,
  ...eduExcused,
  ...eduMgmt,
  ...eduExcusedSelf,
  ...deliveryReview,
};

// 11/4 개인정보: AI(제미나이)를 부르는 기능은 요청한 교사의 섭외자 이름을 '섭외자A·B…'로 가려서 보낸다(lib/gemini.js withPrivacy).
import { withPrivacy } from './lib/gemini.js';
const AI_ACTIONS = ['generateContent', 'getActivityFeedback', 'analyzeDistrictData', 'aiCoach',
  'planCohortLead', 'writeCaseDraft', 'targetInfoFeedback', 'targetMasterFeedback'];
for (const name of AI_ACTIONS) {
  const fn = actions[name];
  if (fn) actions[name] = (body) => withPrivacy(body || {}, () => fn(body));
}
