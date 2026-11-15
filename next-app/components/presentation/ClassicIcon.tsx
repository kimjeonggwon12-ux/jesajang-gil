import icons from './classic-icons.json';
export type ClassicIconName=keyof typeof icons|'account'|'bell'|'home'|'install'|'delete';
const extra={
 account:<><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
 bell:<><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></>,
 home:<><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></>,
 install:<><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4"/></>,
 delete:<><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
};
export default function ClassicIcon({name}:{name:ClassicIconName}){
 const props={viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,'aria-hidden':true as const};
 // 저장소의 고정 SVG만 사용한다. API나 사용자 입력을 HTML에 넣지 않는다.
 return name in icons?<svg {...props} dangerouslySetInnerHTML={{__html:icons[name as keyof typeof icons]}}/>:<svg {...props}>{extra[name as keyof typeof extra]}</svg>;
}
