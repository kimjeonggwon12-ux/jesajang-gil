// 공무 본인 신고 표시 함수 — A(app.html EXS-VIEW 블록)와 같아야 한다(tests/edu-mgmt-ui.test.mjs).
export type ExsMine={kind:string;date:string;label:string;reason:string;active:boolean;dept:string;region:string;at:string};
export type ExsDate={date:string;label:string;mine?:ExsMine|null};
export type ExsKind={kind:string;title:string;dates:ExsDate[]};
export type ExsData={enabled:boolean;eligible?:boolean;reason?:string;title?:string;group?:string;dept?:string;region?:string;name?:string;kinds?:ExsKind[];note?:string};
export function exsGroupText(d:{group?:string;region?:string}){return (d.group||'')+(d.region?' · '+d.region:'');}
// 11/16(사용자): '공무결석' 보고 가능시간(표시만, A EXS-VIEW 와 같음)
export const EXS_WINDOW:Record<string,string>={화전단:'월 09:00 ~ 화 19:30',목사교:'수 09:00 ~ 목 19:30',금요교사:'목 09:00 ~ 금 19:30'};
export function exsWindowText(kind:string){return EXS_WINDOW[kind]?'⏰ 보고 가능시간 '+EXS_WINDOW[kind]:'';}
export function exsLine(x:ExsDate){return x.mine?'✅ 공무 결석 신고됨'+(x.mine.reason&&x.mine.reason!=='공무'?' · '+x.mine.reason:''):'아직 신고 안 함';}
