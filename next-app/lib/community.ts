export type PlazaPost={postId:string;memberId:string;name:string;category:string;title:string;summary:string;tags:string[];thumb:string;photoCount:number;likeCount:number;liked:boolean;commentCount:number;createdAt:string;updatedAt:string;region:string;dept:string;tier:string;isMine:boolean;body?:string;photos?:string[];authorPhoto?:string;coupon?:boolean};
export type PlazaComment={commentId:string;memberId:string;name:string;text:string;createdAt:string;region:string;isMine:boolean};
export type PostData={post:PlazaPost;comments:PlazaComment[]};
export type PostList={rows:PlazaPost[];total:number;hot?:PlazaPost[];writers?:{memberId:string;name:string;region:string;dept:string;count:number}[]};
export type MonthlyData={month:string;teachers:{dept:string;name:string;region:string;tier:string;photo:string;score:number;count:number;positive:number;targets:number;bestStage:string;items:{item:string;count:number}[];summary:string}[];coupon:PlazaPost[];popular:PlazaPost[]};
export const CASE_SECTIONS=[
 {t:'마음 사기 · 친분',s:'첫 만남 · 공감 · 소망 심기'},
 {t:'단계 향상 방법',s:'섭외 → 친분 → 만남 → 상담 → 복음방'},
 {t:'경계 낮추기 · 방해 극복',s:'신뢰 쌓기 · 방해 요소와 이겨 낸 방법'},
 {t:'교사 연결',s:'연결 방법 · 교사 컨셉'},
 {t:'성경 띄우기',s:'기간 띄우기 · 동기 부여'},
 {t:'센터 소개',s:'시기 · 방법 · 소개 멘트'},
 {t:'깨달은 점',s:'감사 · 배운 점'},
];
export function caseCompose(sections:string[]){let n=0;return CASE_SECTIONS.map((s,i)=>{const value=String(sections[i]||'').trim();return value?`${++n}. ${s.t} (${s.s})\n${value}`:'';}).filter(Boolean).join('\n\n');}
export function caseParse(body:string){const sections=CASE_SECTIONS.map(()=>'');let current=-1,found=false,before='';for(const line of String(body||'').split('\n')){const match=line.match(/^\s*\d+\.\s*(.+?)\s*(\([^)]*\))?\s*$/),index=match?CASE_SECTIONS.findIndex(s=>s.t===match[1].trim()):-1;if(index>=0){current=index;found=true;continue;}if(current<0){before+=line.trim();continue;}sections[current]+=(sections[current]?'\n':'')+line;}return found&&!before?sections.map(s=>s.trim()):null;}
export const isCase=(category:string)=>['사례','성공사례','실패사례'].includes(category);
export const CONTEST_TAG='[이름 공모]';
export function contestOrder(posts:PlazaPost[]){return posts.filter(p=>p.title.startsWith(CONTEST_TAG)).sort((a,b)=>b.likeCount-a.likeCount||b.commentCount-a.commentCount||(a.createdAt<b.createdAt?1:-1));}
export const contestName=(p:PlazaPost)=>p.title.slice(CONTEST_TAG.length).trim()||'(이름 없음)';
export const contestMeaning=(p:PlazaPost)=>p.summary.replace(/^\s*담은\s*뜻\s*[:：]\s*/,'');
export function commentOrder(comments:PlazaComment[],descending:boolean){return descending?[...comments].reverse():comments;}
export function postTags(text:string){return [...new Set(text.split(/[\s,]+/).map(s=>s.replace(/^#+/,'').slice(0,20)).filter(Boolean))].slice(0,10);}
export function mosaicRect(width:number,height:number,start:{x:number;y:number},end:{x:number;y:number},tap:boolean){const side=Math.min(width,height)*.16;const x=Math.max(0,Math.round(tap?start.x-side/2:Math.min(start.x,end.x))),y=Math.max(0,Math.round(tap?start.y-side/2:Math.min(start.y,end.y)));return {x,y,w:Math.min(width-x,Math.round(tap?side:Math.abs(end.x-start.x))),h:Math.min(height-y,Math.round(tap?side:Math.abs(end.y-start.y)))};}
