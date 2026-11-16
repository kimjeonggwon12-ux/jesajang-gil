export type ApiFailure = {error?:string; auth?:boolean; needsRegistration?:boolean; needsRecovery?:boolean; needPin?:boolean};
export class SessionExpired extends Error {}

export async function callApi<T>(action:string, data:Record<string,unknown>={}, token=''):Promise<T & ApiFailure> {
  const response = await fetch('/api', {
    method:'POST', cache:'no-store', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...data, action, ...(token ? {_tk:token} : {})}),
  });
  if(!response.headers.get('content-type')?.includes('application/json')) throw new Error('서버에 연결하지 못했어요. 다시 시도해 주세요.');
  const result = await response.json();
  if(response.status===401 || result.auth===false) throw new SessionExpired(result.error || '다시 로그인해 주세요.');
  if(!response.ok) throw new Error(result.error || '잠시 후 다시 시도해 주세요.');
  return result;
}

// 동시에 같은 읽기를 요청한 경우에만 공유한다. 토큰별로 분리하고 완료한 개인정보는 캐시하지 않는다.
const reads = new Map<string,Promise<unknown>>();
export type ReadAction='getBackupSummary'|'getPilotAdmin'|'getCenterPolicy'|'getHistory'|'getCoachList'|'pinStatus'|'getRoster'|'getRequiredEducationLog'|'getNoticeIndex'|'getMyEncouragements'|'getChatList'|'getCenterSendBadge'|'getMyGospelLeads'|'getMyCenterLeads'|'checkAdmin'|'getMyTierStatus'|'getTeacherDirectory'|'getConnectCard'|'getRequiredEducation'|'getOrgSummary'|'getDistrictReport'|'getSettlementReport'|'getNonParticipants'|'searchRoster'|'getRosterLog'|'getPinRecoveryContact'|'getBackups'|'getAllCenterLeads'|'getChurchTopRegions'|'getTopRegions'|'getActivityItemDistribution'|'getKeyStageCount'|'getConnectStats'|'getMyActivities'|'getMyActivityPage'|'getMyActivity'|'getMyTargets'|'getTargetJournal'|'getTargetInfo'|'getTargetFile'|'listMyRooms'|'listOpeningRooms'|'getTargetRoom'|'getRoomRecords'|'searchRoomInvitees'|'getCalendarEvents'|'getCalendarAds'|'getAdQuestions'|'getEventCheers'|'getMyEventSignups'|'getCalendarReport'|'listPlazaPosts'|'getPlazaPost'|'getPlazaMonthly'|'getMemberContact'|'searchConnectCards'|'getHelpPosts'|'getConnectAdminOverview'|'getMyCoach'|'getMyCoachRequests'|'getCoachFeedbacks'|'getAllFeedback'|'heartsDossier'|'getOrgAiSnapshot'|'getCourseList'|'getVideos'|'getVideoInfo'|'getVideoRequests'|'getLectures'|'getLectureStats'|'getVideoTranscript'|'getMyAttendance'|'getAttendAdmin'|'getAttendCount'|'educationDelegations'|'educationAccess'|'cohortList'|'cohortDetail'|'cohortTimetable'|'cohortSubmissions'|'cohortDayWork'|'cohortSheet'|'cohortBoardImage'|'getCenterDesk'|'getCenterSendState'|'findCenterStaff'|'eduMgmtAccess'|'getMyExcused';
export function readApi<T>(action:ReadAction, token:string,body:Record<string,unknown>={}):Promise<T & ApiFailure> {
  const key=token+'\n'+action+'\n'+JSON.stringify(body);
  const running=reads.get(key);
  if(running)return running as Promise<T & ApiFailure>;
  const promise=callApi<T>(action,body,token).finally(()=>reads.delete(key));
  reads.set(key,promise);return promise;
}
