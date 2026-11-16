// 공무 본인 신고 표시 함수 — A(app.html EXS-VIEW 블록)와 같아야 한다(tests/edu-mgmt-ui.test.mjs).
export type ExsMine={kind:string;date:string;label:string;reason:string;active:boolean;dept:string;region:string;at:string};
export type ExsDate={date:string;label:string;mine?:ExsMine|null};
export type ExsKind={kind:string;title:string;dates:ExsDate[]};
export type ExsData={enabled:boolean;eligible?:boolean;reason?:string;title?:string;group?:string;dept?:string;region?:string;name?:string;kinds?:ExsKind[]};
export function exsGroupText(d:{group?:string;region?:string}){return (d.group||'')+(d.region?' · '+d.region:'');}
export function exsLine(x:ExsDate){return x.mine?'✅ 공무 신고됨'+(x.mine.reason&&x.mine.reason!=='공무'?' · '+x.mine.reason:''):'아직 신고 안 함';}
