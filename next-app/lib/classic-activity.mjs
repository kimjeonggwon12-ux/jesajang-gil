// app.html의 단계 색/시각/게이지 표시만 옮긴다. 저장값과 집계는 변경하지 않는다.
export function relativeActivityTime(value,now=Date.now()){
 const raw=String(value||'').trim();if(!raw)return '';
 const date=new Date(raw.replace(' ','T'));if(Number.isNaN(date.getTime()))return raw.split(' ')[0];
 const minutes=Math.floor((now-date.getTime())/60000);
 if(minutes<1)return '방금 전';if(minutes<60)return `${minutes}분 전`;
 if(minutes<1440)return `${Math.floor(minutes/60)}시간 전`;if(minutes<2880)return '어제';
 return `${date.getMonth()+1}월 ${date.getDate()}일`;
}
export function classicFlowStep(stage,course){
 if(stage==='센터소개')return 7;
 if(stage==='센터수강')return 8+Math.max(0,['개강','초등','중등','고등','수료'].indexOf(course||'개강'));
 return ['섭외','친분','만남1','만남2','상담1','상담2','복음방'].indexOf(stage);
}
export function classicStageStyle(stage){
 const colors=stage==='섭외'||stage==='친분'?['#EFF6FF','#BFDBFE','#1D4ED8']:
 stage==='만남1'||stage==='만남2'?['#F0F9FF','#BAE6FD','#0369A1']:
 stage==='상담1'||stage==='상담2'?['#FFF7ED','#FED7AA','#C2410C']:
 stage==='복음방'?['#FEF2F2','#FECACA','#B91C1C']:
 stage==='센터소개'||stage==='센터수강'?['#FEF2F2','#FCA5A5','#991B1B']:['#F9FAFB','#E5E7EB','#6B7280'];
 return {background:colors[0],borderColor:colors[1],color:colors[2]};
}
