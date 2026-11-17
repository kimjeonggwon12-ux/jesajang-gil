export type RoomMessage={id:number;from:string;mine:boolean;fk:number;text:string;photo:string;file:{url:string;name:string;size:number}|null;pinned:boolean;deleted:boolean;at:string};
export type RoomMember={key:number;name:string;role:string;by:string;me:boolean;at:string};
export type Invitee={key:string;name:string;dept:string;region:string;affiliation?:string;position?:string;joined:boolean;query?:string;role?:string;missing?:boolean};
export type RoomInvite={code:string;raw:string;by?:string;expires:string;uses:number;max:number};
export type RoomTarget={id:string;name:string;stage:string;gender:string;ageGroup:string;teacher:string;goalMonth:number};
export type Room={messages:RoomMessage[];reads:[number,number][];isOwner:boolean;canManage:boolean;target:RoomTarget;members:RoomMember[];pins:RoomMessage[];invites:RoomInvite[];crew:Invitee[]};
export type RoomRow=RoomTarget&{unread:number;fbUnread:number;members:number;isOwner:boolean;last:{text:string;from:string;at:string}|null};
export type OpeningRoom=RoomTarget&{dept:string;region:string;room:boolean;members:number;admins:string[];inRoom:boolean;unread:number;lastAt:string;lastReport:string;dup?:number};
export const ROOM_DEPTS=['교역자','자문회','장년회','부녀회','청년회'];
export const ROOM_STAGES=['상담1','상담2','복음방','센터소개','센터수강'];
export const roomDept=(row:OpeningRoom)=>ROOM_DEPTS.includes(row.dept)?row.dept:'그 밖';
export const roomRegionNo=(region:string)=>{const match=String(region||'').match(/\d+/);return match?Number(match[0]):99;};
export const roomRegion=(row:OpeningRoom)=>{const number=roomRegionNo(row.region);return number<99?String(number):(row.region.trim()||'지역 없음');};
export type OpeningFilter={dept:string;regions:string[];stages:string[];query:string;only:boolean};
export function filterOpeningRooms(rows:OpeningRoom[],filter:OpeningFilter){
  const q=filter.query.trim(),match=q.match(/^0*(\d{1,2})\s*(지역)?$/),number=match?Number(match[1]):0;
  return rows.filter(row=>(filter.dept==='전체'||roomDept(row)===filter.dept)&&(!filter.regions.length||filter.regions.includes(roomRegion(row)))&&(!filter.stages.length||filter.stages.includes(row.stage))&&(!filter.only||row.room)&&(!q||(number?roomRegionNo(row.region)===number:[row.teacher,row.region,row.dept,row.name].join(' ').includes(q))))
    .sort((a,b)=>String(b.lastReport||'').localeCompare(String(a.lastReport||''))||[...ROOM_DEPTS,'그 밖'].indexOf(roomDept(a))-[...ROOM_DEPTS,'그 밖'].indexOf(roomDept(b))||roomRegionNo(a.region)-roomRegionNo(b.region)||String(a.teacher).localeCompare(String(b.teacher)));
}
export type RoomRecord={at:string;basis?:string;text?:string;about?:string;source?:string;situation?:string;ai?:string;handler?:string;answer?:string;cat?:string;by?:string;roles?:string[];items?:string[];stage?:string;consult?:string;subject?:string;reaction?:string;reactionNote?:string;today?:string;next?:string;special?:string;from?:string;to?:string;memo?:string};
export type RoomRecords={goalMonth:number;info:RoomRecord[];infoFeedback:RoomRecord[];master:RoomRecord[];moving:RoomRecord[];plans:RoomRecord[];stageFb:RoomRecord[];hearts:RoomRecord[];acts:RoomRecord[];history:RoomRecord[]};
export const cleanRoomCode=(value:string)=>value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
export function roomUnread(message:RoomMessage,reads:[number,number][]){return message.deleted||(!message.from&&!message.mine)?0:reads.filter(([key,last])=>key!==message.fk&&Number(last)<message.id).length;}
export function mergeRoomMessages(current:RoomMessage[],incoming:RoomMessage[]){const rows=new Map(current.map(row=>[row.id,row]));for(const row of incoming)rows.set(row.id,row);return [...rows.values()].sort((a,b)=>a.id-b.id);}
export function roomInviteText(origin:string,raw:string){const code=cleanRoomCode(raw);return `[교사광장] 피드백방 초대\n아래 링크를 누르고 내 고유번호·이름으로 들어오면 대화방을 이용할 수 있어요. (24시간)\n초대 코드: ${code.slice(0,4)}-${code.slice(4)}\n${origin}/rooms?code=${code}`;}
export const DOC_EXTENSIONS=['ppt','pptx','pps','ppsx','hwp','hwpx','pdf'];
export const ROOM_FILE_MAX=50*1024*1024,ROOM_INLINE_MAX=3*1024*1024;
export type RoomAttachment={id:number;photo?:string;file?:File;name:string;uploaded?:{url:string;name:string}};
export function roomFileError(file:Pick<File,'name'|'size'|'type'>){if(file.type.startsWith('image/'))return '';if(!DOC_EXTENSIONS.includes(file.name.split('.').pop()?.toLowerCase()||'')||!file.size)return 'PPT·한글(hwp·hwpx)·PDF·사진만 올릴 수 있어요.';return file.size>ROOM_FILE_MAX?'파일은 50MB까지 올릴 수 있어요.':'';}
