import {DIALOG_HISTORY_KEY} from './dialog-history.ts';
export const ROOT_HISTORY_KEY='__teacherSquareRoot';
export const EXIT_MESSAGE='뒤로가기를 한 번 더 누르면 앱에서 나가요.';
export const EXIT_NOTICE_MS=2600;
type State=Record<string,unknown>;
type Port={state:()=>unknown;replace:(state:State)=>void;push:(state:State)=>void;currentSession:()=>string|null};
const object=(v:unknown):State=>v&&typeof v==='object'?v as State:{};
// 이동 경계를 잇기 위한 식별만 한다. 인증 여부는 MemberArea의 서버 재확인이 결정한다.
const memberOf=(scope:string)=>scope.match(/^m([1-9]\d{0,39})\./)?.[1];

// 첫 로그인 화면에서 손이 닿은 뒤에만 지킴 칸을 만든다. 세션/자료는 history에 넣지 않는다.
export class RootHistory {
 private scope='';private owner='';private serial=0;private message='';private listeners=new Set<(value:string)=>void>();
 private waiting=false;private renewal:{scope:string;owner:string;waiting:boolean}|null=null;
 private port:Port;private documentId:string;
 constructor(port:Port,documentId:string){this.port=port;this.documentId=documentId;}
 private emit(value:string){if(this.message===value)return;this.message=value;for(const listener of this.listeners)listener(value);}
 private marker(){return object(object(this.port.state())[ROOT_HISTORY_KEY]);}
 private active(){return !!this.scope&&this.port.currentSession()===this.scope;}
 subscribe(listener:(value:string)=>void){this.listeners.add(listener);listener(this.message);return()=>{this.listeners.delete(listener);};}
 sessionChanged(){
  if(this.active())return;
  const next=this.port.currentSession(),previous=this.scope||this.renewal?.scope||'',owner=this.owner||this.renewal?.owner||'';
  const sameMember=!!next&&!!memberOf(previous)&&memberOf(previous)===memberOf(next);
  this.renewal=sameMember&&owner?{scope:next!,owner,waiting:this.scope?this.waiting:!!this.renewal?.waiting}:null;
  this.scope='';this.owner='';this.waiting=false;this.emit('');
 }
 clearNotice(){this.emit('');}
 private settle(){
  if(!this.waiting||!this.active()||Number(object(object(this.port.state())[DIALOG_HISTORY_KEY]).depth)>0)return false;
  this.waiting=false;
  try{this.port.replace({...object(this.port.state()),[ROOT_HISTORY_KEY]:{owner:this.owner,kind:'root'}});}catch{}
  return true;
 }
 enter(scope:string){
  if(!scope||this.port.currentSession()!==scope)return;
  if(this.scope===scope){this.settle();if(this.marker().owner!==this.owner)this.emit('');return;}
  const renewal=this.renewal?.scope===scope?this.renewal:null;this.renewal=null;
  if(renewal){this.scope=scope;this.owner=renewal.owner;this.waiting=renewal.waiting;this.settle();this.emit('');return;}
  const marker=this.marker(),resume=this.serial===0&&typeof marker.owner==='string'&&['root','guard'].includes(String(marker.kind));
  this.scope=scope;this.serial++;this.owner=resume?String(marker.owner):`${this.documentId}:${this.serial}`;this.emit('');
  // 다른 계정 입장도 닫히는 이전 팝업 칸에 새 루트를 쓰지 않는다.
  this.waiting=!resume&&Number(object(object(this.port.state())[DIALOG_HISTORY_KEY]).depth)>0;
  if(this.waiting)return;
  try{this.port.replace({...object(this.port.state()),[ROOT_HISTORY_KEY]:{owner:this.owner,kind:resume?marker.kind:'root'}});}catch{}
 }
 touch(){
  if(!this.active())return;
  this.settle();if(this.waiting)return;
  const state=object(this.port.state()),marker=this.marker(),dialog=object(state[DIALOG_HISTORY_KEY]);
  if(marker.owner!==this.owner||marker.kind!=='root'||Number(dialog.depth)>0)return;
  try{this.port.push({...state,[ROOT_HISTORY_KEY]:{owner:this.owner,kind:'guard'}});this.emit('');}catch{}
 }
 pop(dialogHandled=false){
  if(this.waiting){this.settle();this.emit('');return;}
  const marker=this.marker();
  this.emit(this.active()&&!dialogHandled&&marker.owner===this.owner&&marker.kind==='root'?EXIT_MESSAGE:'');
 }
}

// 브라우저 뒤로/앞으로 단축키 자체로 지킴 칸을 다시 만들지 않는다.
export function isHistoryInteraction(event:{type:string;key?:string;altKey?:boolean;ctrlKey?:boolean;metaKey?:boolean}){
 return event.type!=='keydown'||!event.altKey&&!event.ctrlKey&&!event.metaKey&&event.key!=='Escape'&&event.key!=='BrowserBack'&&event.key!=='BrowserForward';
}
