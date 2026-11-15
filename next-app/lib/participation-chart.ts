import type {OrgSummary} from './status';
import {participationRows,participationTitle} from './status-extra';
const colors:Record<string,string>={'교역자':'#6366F1','자문회':'#0EA5E9','장년회':'#00AE82','부녀회':'#F97316','청년회':'#EC4899'};
// 기존 참여 이미지의 5개 부서·비율·합계와 제목/기준일을 유지한다.
export function drawParticipation(canvas:HTMLCanvasElement,report:OrgSummary,width:number){
 const rows=participationRows(report),w=Math.max(300,Math.min(width,1200)),top=92,rowH=54,h=top+rows.length*rowH+64;
 canvas.width=w*2;canvas.height=h*2;canvas.style.width=w+'px';canvas.style.height=h+'px';
 const g=canvas.getContext('2d');if(!g)return;
 g.setTransform(2,0,0,2,0,0);g.fillStyle='#fff';g.fillRect(0,0,w,h);
 const font=(weight:number,size:number)=>`${weight} ${size}px Pretendard, 'Malgun Gothic', sans-serif`;
 g.fillStyle='#111';g.font=font(900,w<400?19:22);g.fillText(participationTitle(report.month),20,38);
 g.fillStyle='#767676';g.font=font(500,13);g.fillText(`${report.asOf} 기준 · ${w<560?'이번 달 기록한 교사 / 총 교사':'이번 달 활동을 1건 이상 기록한 교사 / 총 교사'}`,20,62);
 const barX=84,valW=w<520?118:150,barW=w-barX-valW-20;let active=0,total=0;
 for(const [index,row] of rows.entries()){
  const y=top+index*rowH,ratio=row.total?row.active/row.total:0;active+=row.active;total+=row.total;
  g.fillStyle='#111';g.font=font(800,16);g.textBaseline='middle';g.fillText(row.dept,20,y+16);
  g.fillStyle='#F1F2F4';g.beginPath();g.roundRect(barX,y+2,barW,28,8);g.fill();
  if(row.active>0){g.fillStyle=colors[row.dept];g.beginPath();g.roundRect(barX,y+2,Math.max(16,barW*ratio),28,8);g.fill();}
  g.fillStyle=colors[row.dept];g.font=font(900,17);g.fillText((ratio*100).toFixed(1)+'%',barX+barW+12,y+10);
  g.fillStyle='#505050';g.font=font(600,12.5);g.fillText(`${row.active.toLocaleString()} / ${row.total.toLocaleString()}명`,barX+barW+12,y+28);
 }
 const y=top+rows.length*rowH+8;g.strokeStyle='#EDEDED';g.beginPath();g.moveTo(20,y);g.lineTo(w-20,y);g.stroke();
 g.fillStyle='#111';g.font=font(900,16);g.fillText('전체',20,y+28);g.fillStyle='#008867';g.font=font(900,w<400?14:18);
 g.fillText(`${active.toLocaleString()} / ${total.toLocaleString()}명 참여 (${total?(active/total*100).toFixed(1):'0.0'}%)`,barX,y+28);
}
