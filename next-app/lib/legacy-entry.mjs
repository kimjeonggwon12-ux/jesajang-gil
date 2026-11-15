// 이전 주소는 이동/입력 보조일 뿐이다. 계정/관리자 자격이나 자동 전송 권한을 전달하지 않는다.
export const LEGACY_ENTRIES={
 'app.html':'/activities','home.html':'/activities','activity-room.html':'/activities',
 'admin.html':'/admin','admin-home.html':'/admin','calendar-admin.html':'/calendar?tab=manage',
 'calendar-room.html':'/calendar','plaza-room.html':'/calendar','connect-room.html':'/connect',
 'connect-admin.html':'/connect?tab=admin','district-dashboard.html':'/status','district-leader-view.html':'/status',
 'edu-dashboard.html':'/admin/education','teacher-profile.html':'/members','study-room.html':'/library','feedback-room.html':'/coaching',
};
const tabs={calendar:'/calendar',story:'/community?section=story',activity:'/activities',connect:'/connect',ai:'/coaching',textbook:'/library',join:'/community?section=yard',admin:'/admin'};
const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const identity=v=>({memberId:/^[0-9 -]{8,40}$/.test(v.memberId||'')?v.memberId:'',name:text(v.name,30),dept:text(v.dept,20)});
export function decodeCarry(hash){const encoded=new URLSearchParams(hash.replace(/^#/, '')).get('carry');if(!encoded||encoded.length>4096||!/^[\w-]+$/.test(encoded))return null;try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));return v&&typeof v==='object'?identity(v):null;}catch{return null;}}
export function resolveLegacyEntry(pathname,search='',hash=''){
 const filename=pathname.replace(/^\//,''),root=pathname==='/',p=new URLSearchParams(search),h=new URLSearchParams(hash.replace(/^#/,'')),anchor=hash.replace(/^#/,'').split('&')[0];
 if(!root&&!Object.hasOwn(LEGACY_ENTRIES,filename))return null;
 if(root&&!search&&!hash)return null;
 if(root&&!search&&['main-content','notices'].includes(anchor))return null;
 if(root&&p.get('view')==='notices'&&[...p.keys()].length===1&&['','notices'].includes(anchor))return null;
 let href=root?'/':LEGACY_ENTRIES[filename],error='';
 if(Object.hasOwn(tabs,anchor))href=tabs[anchor];
 if(p.get('embed')==='plaza')href='/calendar';
 const attend=h.get('attend')||p.get('attend')||p.get('meeting'),room=h.get('room')||p.get('room');
 if(h.has('attend')||p.has('attend')||p.has('meeting')){if(/^(MT|RS|CH)[A-Za-z0-9_-]{1,38}$/.test(attend))href='/attend?meeting='+encodeURIComponent(attend);else error='출석 링크의 모임 번호를 확인해 주세요.';}
 else if(h.has('room')||p.has('room')){if(/^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$/.test(room))href='/rooms?code='+room.replace('-','').toUpperCase();else error='초대 링크의 코드를 확인해 주세요.';}
 if(filename==='district-dashboard.html'&&p.get('view')==='teachers')href='/members';
 const hints=decodeCarry(hash)||identity({memberId:p.get('memberId'),name:p.get('name'),dept:p.get('dept')});
 let chat=null,coaching=null;
 if(!attend&&!room&&['connect-room.html','feedback-room.html'].includes(filename)&&p.get('chatWith')){
  const id=p.get('chatWith')||'';if(/^(?:[0-9 -]{8,40}|r_[A-Za-z0-9_-]{10,200})$/.test(id)){href='/connect';chat={id,name:text(p.get('chatWithName'),30),text:text(p.get('autoMsg'),10000)};}else error='대화 상대 정보를 확인해 주세요.';
 }
 if(!attend&&!room&&!chat&&filename==='feedback-room.html'){
  const mode=p.get('tab');href=mode==='history'?'/coaching/history':mode==='askCoach'?'/coaching?tab=requests':mode==='coachMode'?'/coaching?tab=inbox':mode==='coach'?'/coaching?tab=teacher':'/coaching';
  if(p.get('heartsStage')||p.get('targetGroup')||p.get('situation'))coaching={stage:text(p.get('heartsStage'),30),targetGroup:text(p.get('targetGroup'),30),situationText:text(p.get('situation'),20000)};
 }
 return {href,error,hints,chat,coaching};
}
