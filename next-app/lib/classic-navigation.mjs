// 같은 업무를 같은 메뉴 순서에서 연다. 권한 판정은 서버 응답을 그대로 사용한다.
export const CLASSIC_NAV=[
 {id:'calendar',label:'일정·광고',href:'/calendar'},
 {id:'story',label:'사례',href:'/community?section=story'},
 {id:'activity',label:'나의교실',href:'/activities'},
 {id:'connect',label:'연결',href:'/connect'},
 {id:'ai',label:'AI상담',href:'/coaching'},
 {id:'textbook',label:'교재·영상',href:'/library'},
 {id:'join',label:'참여',href:'/community?section=yard'},
 {id:'admin',label:'관리자',href:'/admin',admin:true},
];
export function classicSection(path,search=''){
 if(path.startsWith('/community')){const section=new URLSearchParams(search).get('section');return ['yard','questions','bugs','contest','all'].includes(section)?'join':section==='evangelism'?'calendar':'story';}
 if(path.startsWith('/admin')||path==='/members'||path==='/status'||path==='/centers')return 'admin';
 if(path.startsWith('/calendar'))return 'calendar';
 if(path.startsWith('/connect'))return 'connect';
 if(path.startsWith('/coaching'))return 'ai';
 if(path.startsWith('/library'))return 'textbook';
 return 'activity';
}
export function classicNav(isAdmin){return CLASSIC_NAV.filter(item=>!item.admin||isAdmin);}
